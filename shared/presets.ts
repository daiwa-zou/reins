// Presets from lessons, and which presets fit which engine. Pure: the server
// (GET /api/presets), the web UI (New run, Harness, Lessons) and vitest share
// these rules.
//
// A recipe names a domain (web, cli...) and its base guidance. composePreset()
// starts from the Full config and folds in every lesson whose `domains:` names
// that domain, oldest first (then by slug), so a newer lesson wins a conflict.
import type { ComponentId, Composition, EngineId, GuardrailMode, HarnessEffort, Lesson, Phase, Preset, PresetBasis, PresetCompatibility, PresetConfig, RunConfig, Supervision } from "./types.js";
import { lessonInDomain, namedDomains, stageLessonsFor } from "./implications.js";
import { cleanGuidance, COMPONENTS, DEFAULT_COMPOSITION, defaultRunConfig, EFFORT_LEVELS, EFFORT_TABLE, type EffortComponentId, GUIDANCE_MAX_LINES, isEffort, isSupervision, PAUSE_GATE, PAUSE_KEYS, type PauseKey, SUPERVISION_LEVELS, SUPERVISION_TABLE } from "./components.js";
import { ENGINE_LABEL, sanitizePresetName } from "./config.js";

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
   * An `engine` here is ignored by composeRun. Components, pauses and budgets may only raise effort and tighten
   * supervision; anything else is refused and recorded in the basis.
   */
  config?: Pick<PresetConfig, "roles" | "context" | "guardrail" | "engine" | "components" | "pauses" | "maxFixRounds" | "maxTurnsPerPhase" | "budgetUsd">;
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
 * - Otherwise it fits; `dropped` lists the switches the engine ignores, which
 *   follow the engine (resolved off on it).
 */
export function presetCompatibility(preset: Pick<Preset, "config" | "adaptive">, engine: EngineId): PresetCompatibility {
  const cfg = preset.config ?? {};
  if (cfg.engine && cfg.engine !== engine)
    return { ok: false, adaptive: false, reasons: [`Made for the ${ENGINE_LABEL[cfg.engine]} engine; picking it switches the engine.`], dropped: [] };
  const ignored = onComponents(cfg).filter((id) => DIRECT_ONLY(engine).includes(id));
  if (!ignored.length) return { ok: true, adaptive: false, reasons: [], dropped: [] };
  // Engine-follow: switches the engine ignores are resolved off on it, so every preset fits.
  const names = ignored.map(label).join(", ");
  return { ok: true, adaptive: true, reasons: [`Follows ${ENGINE_LABEL[engine]}: ${ignored.length} switch${ignored.length === 1 ? "" : "es"} off (${names}).`], dropped: ignored };
}

/** The preset as it applies on this engine: an adaptive preset switches off what the engine ignores. */
export function adaptPreset<P extends Pick<Preset, "name" | "config" | "adaptive">>(preset: P, engine: EngineId): P {
  const c = presetCompatibility(preset, engine);
  if (!c.dropped.length) return preset;
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
  const base = compositionConfig(DEFAULT_COMPOSITION.effort, DEFAULT_COMPOSITION.supervision);
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
    // Lessons may only touch effort- and engine-tier components; an always-tier id is ignored.
    const enables = (l.enables ?? []).filter((id) => COMPONENTS.find((c) => c.id === id)?.tier !== "always");
    const disables = (l.disables ?? []).filter((id) => COMPONENTS.find((c) => c.id === id)?.tier !== "always");
    for (const id of enables) set(id, true);
    for (const id of disables) set(id, false);
    if (enables.length) fx.push(`on: ${enables.map(label).join(", ")}`);
    if (disables.length) fx.push(`off: ${disables.map(label).join(", ")}`);
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

// ---- Run composition: Effort + Supervision + any number of domains ---------

export class PresetCompositionError extends Error {}

const MODE_RANK: Record<GuardrailMode, number> = { ask: 0, auto: 1, trust: 2 };

/**
 * The config an effort and a supervision give, before any domain: always-tier
 * components on, effort-tier from EFFORT_TABLE, budgets from EFFORT_TABLE,
 * pauses and guardrail mode from SUPERVISION_TABLE (a pause only when its gate
 * exists at this effort), the classifier only where something reaches it.
 * With an engine, every component that engine does not honour is off.
 */
export function compositionConfig(effort: HarnessEffort, supervision: Supervision, engine?: EngineId): PresetConfig {
  const d = defaultRunConfig({ task: "", workspace: "" });
  const e = EFFORT_TABLE[effort];
  const s = SUPERVISION_TABLE[supervision];
  const components = {} as Record<ComponentId, boolean>;
  for (const c of COMPONENTS) components[c.id] = c.tier === "always" ? true : c.tier === "effort" ? e.components[c.id as EffortComponentId] : s.actionClassifier;
  if (engine) Object.assign(components, followEngine({ components }, engine).components);
  const pauses = Object.fromEntries(PAUSE_KEYS.map((k) => [k, s.pauses[k] && components[PAUSE_GATE[k]]])) as Record<PauseKey, boolean>;
  const cfg: PresetConfig = {
    components,
    roles: d.roles,
    pauses,
    context: d.context,
    guardrail: { ...d.guardrail, mode: s.mode },
    budgetUsd: e.budgetUsd,
    maxTurnsPerPhase: e.maxTurnsPerPhase,
    maxFixRounds: e.maxFixRounds,
  };
  return cfg;
}

/** Engine-follow: a component the engine does not honour is resolved off on it (any tier; not an ablation). */
export function followEngine<C extends { components?: Partial<Record<ComponentId, boolean>> }>(cfg: C, engine: EngineId | "replay"): C {
  if (engine === "replay") return cfg;
  const off = DIRECT_ONLY(engine);
  if (!off.length) return cfg;
  return { ...cfg, components: { ...(cfg.components ?? {}), ...Object.fromEntries(off.map((id) => [id, false])) } };
}

/** "High · Check in · Go · CLI", plus "· Experiment: without Compaction" for an ablated run. */
export function compositionLabel(c: Partial<Composition>, ablated: string[] = []): string {
  const parts = [EFFORT_TABLE[c.effort ?? DEFAULT_COMPOSITION.effort].label, SUPERVISION_TABLE[c.supervision ?? DEFAULT_COMPOSITION.supervision].chip, ...(c.domains ?? []).map(presetChip)];
  if (ablated.length) parts.push(`Experiment: without ${ablated.map((id) => label(id as ComponentId)).join(", ")}`);
  return parts.join(" · ");
}

export interface EffortRecommendation {
  slug: string;
  title: string;
  domain: string;
  level: HarnessEffort;
  claim: string;
}

/** Trusted `[effort:<level>]` implications for the picked domains. Shown on New run; never applied. */
export function effortRecommendations(lessons: Lesson[], domains: string[]): EffortRecommendation[] {
  const out: EffortRecommendation[] = [];
  for (const l of lessons)
    for (const i of l.items ?? [])
      if (i.kind === "effort" && i.standing !== "unreviewed" && isEffort(i.target))
        for (const d of domains) if (i.domains.includes(d) && !out.some((r) => r.slug === l.slug && r.claim === i.claim)) out.push({ slug: l.slug, title: l.title, domain: d, level: i.target, claim: i.claim });
  return out;
}

export interface ComposedRun {
  effort: HarnessEffort;
  supervision: Supervision;
  domains: string[];
  config: PresetConfig;
  basis: PresetBasis[];
  stageLessons: Partial<Record<Phase, string[]>>;
  label: string;
  /** Effort levels lessons recommend for the picked domains; never applied to `config`. */
  recommendations: EffortRecommendation[];
}

/**
 * Layer domains over the effort and supervision dials, in the order picked:
 * - enables:/disables: may touch only effort- and engine-tier components; an always-tier id is ignored;
 * - a domain may only raise effort (no effort-tier component the dial turned on goes off; fix rounds,
 *   turns and budget only go up) and only tighten supervision (no pause goes off; the guardrail mode only
 *   moves toward ask; no allowNetwork, no allowPatterns; no classifier in ask mode);
 * - every refused effect is recorded in the basis with a reason, never applied, never thrown;
 * - guidance: the union of recipe and lesson lines, deduplicated and capped;
 * - stage lessons: trusted stage implications for the picked domains (or untagged);
 * - roles / context: later wins per key; engine: never set by a domain.
 * `recipes` defaults to PRESET_RECIPES; tests pass their own to exercise the rules.
 */
export function composeRun(input: Partial<Composition> | null | undefined, lessons: Lesson[], recipes: PresetRecipe[] = PRESET_RECIPES, engine?: EngineId): ComposedRun {
  const raw = (input ?? {}) as Record<string, unknown>;
  const effort = raw.effort === undefined || raw.effort === null ? DEFAULT_COMPOSITION.effort : raw.effort;
  const supervision = raw.supervision === undefined || raw.supervision === null ? DEFAULT_COMPOSITION.supervision : raw.supervision;
  if (!isEffort(effort)) throw new PresetCompositionError(`unknown effort "${String(effort)}" (use ${EFFORT_LEVELS.join(", ")})`);
  if (!isSupervision(supervision)) throw new PresetCompositionError(`unknown supervision "${String(supervision)}" (use ${SUPERVISION_LEVELS.join(", ")})`);
  if (raw.domains !== undefined && raw.domains !== null && !Array.isArray(raw.domains)) throw new PresetCompositionError("domains must be an array of domain ids, e.g. [\"golang\",\"cli\"]");
  const domains = [...new Set(((raw.domains as unknown[]) ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const known = presetDomains(lessons, recipes);
  for (const d of domains) if (!known.includes(d)) throw new PresetCompositionError(`unknown domain "${d}" (domains: ${known.join(", ")})`);

  const base = compositionConfig(effort, supervision, engine);
  const dial = { ...base.components } as Record<ComponentId, boolean>;
  const components = { ...dial };
  const pauses = { ...(base.pauses as Record<PauseKey, boolean>) };
  const owner = new Map<ComponentId, string>();
  const roles = { ...(base.roles ?? {}) } as NonNullable<PresetConfig["roles"]>;
  const context = { ...(base.context ?? {}) };
  const guardrail = { ...(base.guardrail ?? {}) } as NonNullable<PresetConfig["guardrail"]>;
  const nums = { maxFixRounds: base.maxFixRounds!, maxTurnsPerPhase: base.maxTurnsPerPhase!, budgetUsd: base.budgetUsd! };
  const guidance: string[] = [];
  const basis: PresetBasis[] = [];
  const dialName = `${EFFORT_TABLE[effort].label} effort`;

  /** Try one component switch; returns the basis text (applied or refused). */
  const trySet = (id: ComponentId, on: boolean, who: string): string => {
    const c = COMPONENTS.find((x) => x.id === id);
    if (!c) return `ignored: unknown component ${id}`;
    if (c.tier === "always") return `ignored: ${c.label} is always on (always-tier)`;
    if (c.tier === "effort" && !on && dial[id]) return `refused: off: ${c.label} (would lower effort below ${dialName})`;
    if (c.tier === "engine" && on && guardrail.mode !== "auto") return `refused: on: ${c.label} (nothing reaches it in ${guardrail.mode} mode)`;
    if (c.tier === "engine" && !on && components[id]) return `refused: off: ${c.label} (would loosen supervision)`;
    const before = components[id];
    components[id] = on;
    const txt = `${on ? "on" : "off"}: ${c.label}${before !== on ? ` (overrides ${owner.get(id) ?? dialName})` : ""}`;
    owner.set(id, who);
    return txt;
  };

  for (const d of domains) {
    const recipe = recipeFor(d, recipes);
    guidance.push(...recipe.guidance);
    const rc = recipe.config ?? {};
    const rfx: string[] = [];
    for (const [r, v] of Object.entries(rc.roles ?? {})) (roles as any)[r] = { ...((roles as any)[r] ?? {}), ...v };
    Object.assign(context, rc.context ?? {});
    for (const [id, on] of Object.entries(rc.components ?? {})) if (typeof on === "boolean") rfx.push(trySet(id as ComponentId, on, recipe.name));
    for (const [k, v] of Object.entries(rc.pauses ?? {})) {
      if (!(PAUSE_KEYS as string[]).includes(k) || typeof v !== "boolean") continue;
      if (!v && pauses[k as PauseKey]) rfx.push(`refused: pause ${k} off (would loosen supervision)`);
      else if (v && !pauses[k as PauseKey]) {
        pauses[k as PauseKey] = true;
        rfx.push(`pause ${k} on`);
      }
    }
    for (const k of ["maxFixRounds", "maxTurnsPerPhase", "budgetUsd"] as const) {
      const v = rc[k];
      if (typeof v !== "number") continue;
      if (v < nums[k]) rfx.push(`refused: ${k} ${v} (would lower effort below ${nums[k]})`);
      else if (v > nums[k]) {
        nums[k] = v;
        rfx.push(`${k} ${v}`);
      }
    }
    const g = rc.guardrail ?? {};
    if (g.mode) {
      if (MODE_RANK[g.mode] > MODE_RANK[guardrail.mode ?? "auto"]) rfx.push(`refused: guardrail mode ${g.mode} (would loosen supervision from ${guardrail.mode})`);
      else if (g.mode !== guardrail.mode) {
        guardrail.mode = g.mode;
        rfx.push(`guardrail mode ${g.mode}`);
        if (g.mode === "ask" && components.actionClassifier) components.actionClassifier = false;
      }
    }
    if (g.allowNetwork === true) rfx.push("refused: allowNetwork (would loosen supervision)");
    if (g.allowPatterns?.length) rfx.push("refused: allowPatterns (would loosen supervision)");
    for (const k of ["askPatterns", "denyPatterns"] as const) if (g[k]?.length) guardrail[k] = [...new Set([...(guardrail[k] ?? []), ...g[k]!])];
    if (rfx.length) basis.push({ slug: `recipe:${d}`, title: recipe.name, effect: `[${d}] ${rfx.join("; ")}` });

    for (const l of lessons.filter((x) => x.standing !== "unreviewed" && lessonInDomain(x, d)).sort(byAge)) {
      const fx: string[] = [];
      for (const id of l.enables ?? []) fx.push(trySet(id, true, l.slug));
      for (const id of l.disables ?? []) fx.push(trySet(id, false, l.slug));
      if (l.guidance) {
        guidance.push(l.guidance);
        fx.push("guidance");
      }
      const stage = (l.items ?? []).filter((i) => i.kind === "stage" && i.domains.includes(d)).length;
      if (stage) fx.push(`${stage} stage lesson${stage === 1 ? "" : "s"}`);
      const rec = (l.items ?? []).filter((i) => i.kind === "effort" && i.domains.includes(d));
      for (const r of rec) fx.push(`recommends ${r.target} effort (not applied)`);
      if (fx.length && !basis.some((b) => b.slug === l.slug && b.effect.startsWith(`[${d}]`))) basis.push({ slug: l.slug, title: l.title, effect: `[${d}] ${fx.join("; ")}` });
    }
  }
  let config: PresetConfig = { ...base, ...nums, components, pauses, roles, context, guardrail, guidance: cleanGuidance(guidance).lines.slice(0, GUIDANCE_MAX_LINES) };
  if (engine) config = followEngine(config, engine);
  // A pause whose gate is off does nothing, so it stays off.
  for (const k of PAUSE_KEYS) if (pauses[k] && !config.components![PAUSE_GATE[k]]) pauses[k] = false;
  const comp = { effort, supervision, domains };
  return { ...comp, config, basis, stageLessons: stageLessonsFor(lessons, domains), label: compositionLabel(comp), recommendations: effortRecommendations(lessons, domains) };
}

// ---- Migration on read (pure; files on disk are never rewritten) -----------

/** The retired care profiles, kept only to read old runs and saved presets. */
export const LEGACY_PROFILES: Record<string, { name: string; effort: HarnessEffort; supervision: Supervision }> = {
  full: { name: "Full", effort: "medium", supervision: "check-in" },
  minimal: { name: "Minimal", effort: "low", supervision: "unattended" },
  careful: { name: "Careful", effort: "high", supervision: "ask-every-write" },
};

export type MigratedComposition = Composition & { engine?: EngineId };

/**
 * Legacy ids (["careful","golang","cli"]) or a legacy name ("Careful", "Claude Code",
 * "Go", "CLI / tool", "Careful · Go · CLI") to a composition. Unknown parts are dropped.
 */
export function migrateLegacy(idsOrName: string[] | string | undefined, recipes: PresetRecipe[] = PRESET_RECIPES): MigratedComposition {
  return parseComposition(idsOrName, recipes).composition;
}

/**
 * Like migrateLegacy, and also reads new chip labels ("High · Check in · Go"); `recognised`
 * says whether every part named something (a retired profile, an effort, a supervision, a domain).
 */
export function parseComposition(idsOrName: string[] | string | undefined, recipes: PresetRecipe[] = PRESET_RECIPES): { composition: MigratedComposition; recognised: boolean } {
  let recognised = true;
  const out: MigratedComposition = { ...DEFAULT_COMPOSITION, domains: [] };
  const parts = Array.isArray(idsOrName) ? idsOrName : String(idsOrName ?? "").split("·");
  const norm = (s: string) => String(s).trim().toLowerCase();
  for (const raw of parts) {
    const p = norm(raw);
    if (!p) continue;
    const eff = EFFORT_LEVELS.find((e) => e === p || EFFORT_TABLE[e].label.toLowerCase() === p);
    const sup = SUPERVISION_LEVELS.find((x) => x === p || SUPERVISION_TABLE[x].chip.toLowerCase() === p || SUPERVISION_TABLE[x].label.toLowerCase() === p);
    if (eff && !Array.isArray(idsOrName)) {
      out.effort = eff;
      continue;
    }
    if (sup && !Array.isArray(idsOrName)) {
      out.supervision = sup;
      continue;
    }
    const prof = Object.entries(LEGACY_PROFILES).find(([id, v]) => id === p || v.name.toLowerCase() === p);
    if (prof) {
      out.effort = prof[1].effort;
      out.supervision = prof[1].supervision;
      continue;
    }
    if (p === "claude code" || p === "claude-code") {
      out.engine = "claude-code";
      continue;
    }
    const r = recipes.find((x) => x.id === p || x.name.toLowerCase() === p || x.short?.toLowerCase() === p);
    const d = r?.id ?? (Array.isArray(idsOrName) && isDomain(p) ? p : undefined);
    if (d && !out.domains.includes(d)) out.domains.push(d);
    if (!d) recognised = false;
  }
  return { composition: out, recognised };
}

/**
 * A composition for a legacy saved preset that has none: mode ask → ask-every-write;
 * all pauses off → unattended; otherwise check-in. Contracts on → high; planner and
 * evaluator off → low; otherwise medium.
 */
export function inferComposition(cfg: PresetConfig): { effort: HarnessEffort; supervision: Supervision } {
  const on = (id: ComponentId) => (typeof cfg.components?.[id] === "boolean" ? cfg.components[id]! : COMPONENTS.find((c) => c.id === id)!.defaultOn);
  const p = cfg.pauses ?? {};
  const supervision: Supervision = cfg.guardrail?.mode === "ask" ? "ask-every-write" : PAUSE_KEYS.every((k) => !p[k]) ? "unattended" : "check-in";
  const effort: HarnessEffort = on("contracts") ? "high" : !on("planner") && !on("evaluator") ? "low" : "medium";
  return { effort, supervision };
}

/** The composition a run was made with: recorded, or derived from its legacy presets / preset name. */
export function compositionOf(cfg: Partial<RunConfig>): MigratedComposition {
  if (isEffort(cfg.effort)) return { effort: cfg.effort, supervision: isSupervision(cfg.supervision) ? cfg.supervision : DEFAULT_COMPOSITION.supervision, domains: [...(cfg.domains ?? [])] };
  if (cfg.presets?.length) return migrateLegacy(cfg.presets);
  if (cfg.preset) return migrateLegacy(cfg.preset);
  return { ...DEFAULT_COMPOSITION, domains: [] };
}

/** The run title chip: the composition label, or the old text for a run that predates Effort and Supervision. */
export function runChipLabel(cfg: Partial<RunConfig> | null | undefined): string {
  if (!cfg) return "";
  if (isEffort(cfg.effort)) return compositionLabel(compositionOf(cfg), cfg.ablated ?? []);
  if (cfg.presets?.length) return presetsLabel(cfg.presets);
  return cfg.preset ?? "";
}

/** Legacy chip for a preset id: "Careful", "Go", "CLI", or a title-cased domain. */
export function presetChip(id: string): string {
  return LEGACY_PROFILES[id]?.name ?? PRESET_RECIPES.find((r) => r.id === id)?.short ?? titleCase(id);
}

/** The legacy run title chip, e.g. "Careful · Go · CLI" (runs recorded with `presets`). */
export function presetsLabel(ids: string[] | undefined): string {
  return (ids ?? []).map(presetChip).join(" · ");
}

/** Domain presets for the picker: built-in recipes plus every domain a trusted lesson or implication names. */
export function domainPresets(lessons: Lesson[]): Preset[] {
  return presetDomains(lessons).map((d) => {
    const p = composePreset(recipeFor(d), lessons);
    return { ...p, id: d, layer: "domain" as const, short: presetChip(d) };
  });
}
