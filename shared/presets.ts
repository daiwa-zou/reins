// Presets from lessons, and which presets fit which engine. Pure: the server
// (GET /api/presets), the web UI (New run, Harness, Lessons) and vitest share
// these rules.
//
// A recipe names a domain (web, cli...) and its base guidance. composePreset()
// starts from the Full config and folds in every lesson whose `domains:` names
// that domain, oldest first (then by slug), so a newer lesson wins a conflict.
import type { ComponentId, EngineId, Lesson, Phase, Preset, PresetBasis, PresetCompatibility, PresetConfig } from "./types.js";
import { lessonInDomain, namedDomains, stageLessonsFor } from "./implications.js";
import { cleanGuidance, COMPONENTS, GUIDANCE_MAX_LINES } from "./components.js";
import { BUILT_IN_PRESETS, ENGINE_LABEL, sanitizePresetName } from "./config.js";

export interface PresetRecipe {
  /** Lesson domain id, e.g. "web". */
  id: string;
  name: string;
  description: string;
  /** Verification guidance every run from this preset gets. */
  guidance: string[];
  /** Chip label in a run title, e.g. "Go". */
  short?: string;
  /**
   * Roles, context and guardrail keys this domain sets (later domains win per key).
   * An `engine` here is ignored by composeRun: the care profile owns the engine.
   */
  config?: Pick<PresetConfig, "roles" | "context" | "guardrail" | "engine">;
}

export const PRESET_RECIPES: PresetRecipe[] = [
  {
    id: "web",
    name: "Web app",
    short: "Web",
    description: "Full, shaped by the web lessons: verify like a user by starting the dev server with a timeout and hitting real pages and endpoints.",
    guidance: [
      "Verify like a user: start the dev server with a timeout (e.g. `timeout 120 npm run dev`) and never leave it running.",
      "Hit the real pages and API endpoints with HTTP requests (curl the routes you changed) and check status codes and bodies, not just unit tests.",
    ],
  },
  {
    id: "cli",
    name: "CLI / tool",
    short: "CLI",
    description: "Full, shaped by the tool-design lessons: verify the command the way a user runs it, including --help and bad input.",
    guidance: [
      "Verify like a user: run the command's --help and check it documents what you changed.",
      "Run one happy path end to end with realistic arguments and check the output.",
      "Run it with bad input and check it exits non-zero with a clear message on stderr.",
    ],
  },
  {
    id: "golang",
    name: "Go",
    short: "Go",
    description: "Full, shaped for Go modules: build, vet and test with the go tool before claiming anything works.",
    guidance: ["Run `go build ./...`, `go vet ./...` and `go test ./...` and show their output before calling finish; gofmt any file you touch."],
  },
  {
    id: "python",
    name: "Python",
    short: "Python",
    description: "Full, shaped for Python projects: run the test suite and the program itself from the project's environment.",
    guidance: ["Run the project's tests (e.g. `python -m pytest -q`) from its own environment and show the output before calling finish."],
  },
];

const DIRECT_ONLY = (engine: EngineId) => COMPONENTS.filter((c) => !c.engines.includes(engine)).map((c) => c.id);
const label = (id: ComponentId) => COMPONENTS.find((c) => c.id === id)?.label ?? id;
const isDomain = (d: string) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(d);

/** Components a preset leaves on, with defaults for the ones it does not name. */
function onComponents(cfg: PresetConfig): ComponentId[] {
  return COMPONENTS.filter((c) => (typeof cfg.components?.[c.id] === "boolean" ? cfg.components[c.id] : c.defaultOn)).map((c) => c.id);
}

/**
 * Can this preset be used on this engine?
 * - A preset that names an engine fits only that engine.
 * - A preset that turns on components the engine ignores does not fit, unless
 *   it is adaptive: then it fits, and `dropped` lists what it switches off.
 */
export function presetCompatibility(preset: Pick<Preset, "config" | "adaptive">, engine: EngineId): PresetCompatibility {
  const cfg = preset.config ?? {};
  if (cfg.engine && cfg.engine !== engine)
    return { ok: false, adaptive: false, reasons: [`Made for the ${ENGINE_LABEL[cfg.engine]} engine; picking it switches the engine.`], dropped: [] };
  const ignored = onComponents(cfg).filter((id) => DIRECT_ONLY(engine).includes(id));
  if (!ignored.length) return { ok: true, adaptive: false, reasons: [], dropped: [] };
  const names = ignored.map(label).join(", ");
  if (preset.adaptive) return { ok: true, adaptive: true, reasons: [`Adapted for ${ENGINE_LABEL[engine]}: ${ignored.length} switch${ignored.length === 1 ? "" : "es"} off (${names}).`], dropped: ignored };
  const other: EngineId = engine === "claude-code" ? "anthropic" : "claude-code";
  return { ok: false, adaptive: false, reasons: [`Needs ${ENGINE_LABEL[other]}: it turns on ${names}, which ${ENGINE_LABEL[engine]} ignores.`], dropped: [] };
}

/** The preset as it applies on this engine: an adaptive preset switches off what the engine ignores. */
export function adaptPreset<P extends Pick<Preset, "name" | "config" | "adaptive">>(preset: P, engine: EngineId): P {
  const c = presetCompatibility(preset, engine);
  if (!c.adaptive || !c.dropped.length) return preset;
  return { ...preset, config: { ...preset.config, components: { ...preset.config.components, ...Object.fromEntries(c.dropped.map((id) => [id, false])) } } };
}

const byAge = (a: Lesson, b: Lesson) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
const titleCase = (d: string) => d.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

/** The recipe for a domain: a built-in one, or a generic recipe for a domain only lessons name. */
export function recipeFor(domain: string, recipes: PresetRecipe[] = PRESET_RECIPES): PresetRecipe {
  return recipes.find((r) => r.id === domain) ?? { id: domain, name: titleCase(domain), description: `Full, shaped by the lessons for the "${domain}" domain.`, guidance: [] };
}

/**
 * Fold the lessons for a recipe's domain over the Full config. Lessons apply
 * oldest first, then by slug, so a newer lesson overrides an older one; the
 * loser's basis entry says so. Guidance is the recipe's plus each lesson's
 * line, deduplicated and capped.
 */
export function composePreset(recipe: PresetRecipe, lessons: Lesson[], opts: { matchAll?: boolean; name?: string } = {}): Preset {
  const base = BUILT_IN_PRESETS[0].config;
  const components: Partial<Record<ComponentId, boolean>> = { ...base.components };
  // Only bundled and reviewed lessons shape presets; unreviewed ones wait on the Ideas list.
  const used = lessons.filter((l) => l.standing !== "unreviewed" && (opts.matchAll || l.domains?.includes(recipe.id))).slice().sort(byAge);
  const owner = new Map<ComponentId, { slug: string; on: boolean }>();
  const effects = new Map<string, string[]>();
  const overridden = new Map<string, string[]>();
  const guidance: string[] = [...recipe.guidance];
  for (const l of used) {
    const fx: string[] = [];
    const set = (id: ComponentId, on: boolean) => {
      const prev = owner.get(id);
      if (prev && prev.slug !== l.slug && prev.on !== on) overridden.set(prev.slug, [...(overridden.get(prev.slug) ?? []), `${label(id)} overridden by ${l.slug}`]);
      owner.set(id, { slug: l.slug, on });
      components[id] = on;
    };
    for (const id of l.enables ?? []) set(id, true);
    for (const id of l.disables ?? []) set(id, false);
    if (l.enables?.length) fx.push(`on: ${l.enables.map(label).join(", ")}`);
    if (l.disables?.length) fx.push(`off: ${l.disables.map(label).join(", ")}`);
    if (l.guidance) {
      guidance.push(l.guidance);
      fx.push("guidance");
    }
    effects.set(l.slug, fx);
  }
  const basis: PresetBasis[] = used.map((l) => {
    const lost = overridden.get(l.slug) ?? [];
    return { slug: l.slug, title: l.title, effect: [...(effects.get(l.slug) ?? []), ...lost].join("; ") || "context" };
  });
  const config: PresetConfig = { ...base, components, guidance: cleanGuidance(guidance).lines.slice(0, GUIDANCE_MAX_LINES) };
  return { name: opts.name ?? recipe.name, description: recipe.description, builtIn: true, generated: true, adaptive: true, domain: recipe.id, basis, config };
}

/** Domains named by the lessons, plus the built-in recipes, in a stable order. */
export function presetDomains(lessons: Lesson[], recipes: PresetRecipe[] = PRESET_RECIPES): string[] {
  const out = recipes.map((r) => r.id);
  for (const d of namedDomains(lessons.filter((l) => l.standing !== "unreviewed"))) if (isDomain(d) && !out.includes(d)) out.push(d);
  return out;
}

/** Every generated preset for this lesson library: Web app, CLI / tool, and one per lesson-only domain. */
export function generatedPresets(lessons: Lesson[]): Preset[] {
  return presetDomains(lessons).map((d) => composePreset(recipeFor(d), lessons));
}

/** Names a user preset may not take: the recipes' (and any generated preset's) names. */
export function isGeneratedPresetName(name: string, lessons: Lesson[] = []): boolean {
  // Compare both the raw and the sanitised form, so "CLI / tool" cannot slip in as "CLI - tool".
  const forms = (s: string) => [s.trim().toLowerCase(), sanitizePresetName(s).toLowerCase()];
  const mine = forms(name);
  return [...PRESET_RECIPES.map((r) => r.name), ...generatedPresets(lessons).map((p) => p.name)].some((g) => forms(g).some((f) => mine.includes(f)));
}

/** Compatibility on every engine, as served by GET /api/presets. */
export function compatibilityByEngine(preset: Pick<Preset, "config" | "adaptive">): Record<EngineId, PresetCompatibility> {
  return { anthropic: presetCompatibility(preset, "anthropic"), "claude-code": presetCompatibility(preset, "claude-code") };
}

// ---- Composable presets: one care profile + any number of domains -----------

/** Care profiles: exactly one per run. */
export const PROFILE_IDS = ["full", "minimal", "careful"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export function profilePreset(id: string): Preset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.layer === "profile" && p.id === id);
}

/** The chip label for a preset id: "Careful", "Go", "CLI", or a title-cased domain. */
export function presetChip(id: string): string {
  return profilePreset(id)?.name ?? PRESET_RECIPES.find((r) => r.id === id)?.short ?? titleCase(id);
}

/** The run title chip, e.g. "Careful · Go · CLI". */
export function presetsLabel(ids: string[] | undefined): string {
  return (ids ?? []).map(presetChip).join(" · ");
}

export interface ComposedRun {
  /** Normalised: the profile first, then the domains in the order picked. */
  presets: string[];
  config: PresetConfig;
  basis: PresetBasis[];
  stageLessons: Partial<Record<Phase, string[]>>;
  label: string;
}

export class PresetCompositionError extends Error {}

/**
 * Layer domain presets over one care profile, in the order picked:
 * - component switches: later wins (a lesson's enables:/disables:), and an override is recorded in the basis;
 * - guidance: the union of the domain's recipe lines and lesson lines, deduplicated and capped;
 * - stage lessons: trusted stage implications tagged with a picked domain (or untagged), deduplicated and capped per stage;
 * - roles / context / guardrail: later wins per key;
 * - engine: owned by the profile, never by a domain.
 * `recipes` defaults to PRESET_RECIPES; tests pass their own to exercise the merge rules.
 */
export function composeRun(ids: string[], lessons: Lesson[], recipes: PresetRecipe[] = PRESET_RECIPES): ComposedRun {
  const clean = [...new Set((ids ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const profiles = clean.filter((x) => (PROFILE_IDS as readonly string[]).includes(x));
  if (profiles.length > 1) throw new PresetCompositionError(`pick exactly one care profile, not ${profiles.join(" and ")}`);
  if (!profiles.length) throw new PresetCompositionError(`pick exactly one care profile (${PROFILE_IDS.join(", ")}) alongside any domains`);
  const profileId = profiles[0];
  const profile = profilePreset(profileId)!;
  const known = presetDomains(lessons, recipes);
  const domains = clean.filter((x) => !(PROFILE_IDS as readonly string[]).includes(x));
  for (const d of domains) if (!known.includes(d)) throw new PresetCompositionError(`unknown preset "${d}" (care profiles: ${PROFILE_IDS.join(", ")}; domains: ${known.join(", ")})`);

  const base = profile.config;
  const components: Partial<Record<ComponentId, boolean>> = { ...base.components };
  const owner = new Map<ComponentId, string>(); // who set each switch last: profile name or lesson slug
  const roles = { ...(base.roles ?? {}) } as NonNullable<PresetConfig["roles"]>;
  const context = { ...(base.context ?? {}) };
  const guardrail = { ...(base.guardrail ?? {}) };
  const guidance: string[] = [...(base.guidance ?? [])];
  const basis: PresetBasis[] = [];
  const trusted = lessons.filter((l) => l.standing !== "unreviewed");
  for (const d of domains) {
    const recipe = recipeFor(d, recipes);
    guidance.push(...recipe.guidance);
    for (const [r, v] of Object.entries(recipe.config?.roles ?? {})) (roles as any)[r] = { ...((roles as any)[r] ?? {}), ...v };
    Object.assign(context, recipe.config?.context ?? {});
    Object.assign(guardrail, recipe.config?.guardrail ?? {});
    for (const l of trusted.filter((x) => lessonInDomain(x, d)).sort(byAge)) {
      const fx: string[] = [];
      const set = (id: ComponentId, on: boolean) => {
        const before = components[id] ?? COMPONENTS.find((c) => c.id === id)?.defaultOn;
        if (before !== on) fx.push(`${on ? "on" : "off"}: ${label(id)} (overrides ${owner.get(id) ?? profile.name})`);
        else fx.push(`${on ? "on" : "off"}: ${label(id)}`);
        components[id] = on;
        owner.set(id, l.slug);
      };
      for (const id of l.enables ?? []) set(id, true);
      for (const id of l.disables ?? []) set(id, false);
      if (l.guidance) {
        guidance.push(l.guidance);
        fx.push("guidance");
      }
      const stage = (l.items ?? []).filter((i) => i.kind === "stage" && i.domains.includes(d)).length;
      if (stage) fx.push(`${stage} stage lesson${stage === 1 ? "" : "s"}`);
      if (fx.length && !basis.some((b) => b.slug === l.slug && b.effect.startsWith(`[${d}]`))) basis.push({ slug: l.slug, title: l.title, effect: `[${d}] ${fx.join("; ")}` });
    }
  }
  const config: PresetConfig = {
    ...base,
    engine: base.engine, // the profile owns the engine
    components,
    roles,
    context,
    guardrail,
    guidance: cleanGuidance(guidance).lines.slice(0, GUIDANCE_MAX_LINES),
  };
  if (!config.engine) delete config.engine;
  const presets = [profileId, ...domains];
  return { presets, config, basis, stageLessons: stageLessonsFor(lessons, domains), label: presetsLabel(presets) };
}

/** Domain presets for the picker: built-in recipes plus every domain a trusted lesson or implication names. */
export function domainPresets(lessons: Lesson[]): Preset[] {
  return presetDomains(lessons).map((d) => {
    const p = composePreset(recipeFor(d), lessons);
    return { ...p, id: d, layer: "domain" as const, short: presetChip(d) };
  });
}
