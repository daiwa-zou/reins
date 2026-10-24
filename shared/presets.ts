// Presets from lessons, and which presets fit which engine. Pure: the server
// (GET /api/presets), the web UI (New run, Harness, Lessons) and vitest share
// these rules.
//
// A recipe names a domain (web, cli...) and its base guidance. composePreset()
// starts from the Full config and folds in every lesson whose `domains:` names
// that domain, oldest first (then by slug), so a newer lesson wins a conflict.
import type { ComponentId, EngineId, Lesson, Preset, PresetBasis, PresetCompatibility, PresetConfig } from "./types.js";
import { cleanGuidance, COMPONENTS, GUIDANCE_MAX_LINES } from "./components.js";
import { BUILT_IN_PRESETS, ENGINE_LABEL, sanitizePresetName } from "./config.js";

export interface PresetRecipe {
  /** Lesson domain id, e.g. "web". */
  id: string;
  name: string;
  description: string;
  /** Verification guidance every run from this preset gets. */
  guidance: string[];
}

export const PRESET_RECIPES: PresetRecipe[] = [
  {
    id: "web",
    name: "Web app",
    description: "Full, shaped by the web lessons: verify like a user by starting the dev server with a timeout and hitting real pages and endpoints.",
    guidance: [
      "Verify like a user: start the dev server with a timeout (e.g. `timeout 120 npm run dev`) and never leave it running.",
      "Hit the real pages and API endpoints with HTTP requests (curl the routes you changed) and check status codes and bodies, not just unit tests.",
    ],
  },
  {
    id: "cli",
    name: "CLI / tool",
    description: "Full, shaped by the tool-design lessons: verify the command the way a user runs it, including --help and bad input.",
    guidance: [
      "Verify like a user: run the command's --help and check it documents what you changed.",
      "Run one happy path end to end with realistic arguments and check the output.",
      "Run it with bad input and check it exits non-zero with a clear message on stderr.",
    ],
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
export function recipeFor(domain: string): PresetRecipe {
  return PRESET_RECIPES.find((r) => r.id === domain) ?? { id: domain, name: titleCase(domain), description: `Full, shaped by the lessons for the "${domain}" domain.`, guidance: [] };
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
  const used = lessons.filter((l) => opts.matchAll || l.domains?.includes(recipe.id)).slice().sort(byAge);
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
export function presetDomains(lessons: Lesson[]): string[] {
  const out = PRESET_RECIPES.map((r) => r.id);
  for (const l of lessons) for (const d of l.domains ?? []) if (isDomain(d) && !out.includes(d)) out.push(d);
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
