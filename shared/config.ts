// Pure helpers over RunConfig: the config checker, built-in presets, applying a
// preset, the diff from defaults and validation of user presets. No I/O, so the
// server, the web UI and vitest all use exactly the same rules.
import type { ComponentId, ConfigWarning, EffortLevel, EngineId, GuardrailMode, HarnessEffort, Preset, PresetConfig, PublishPolicy, Supervision, RoleId, RoleSettings, RunRoleId, RunConfig } from "./types.js";
import { cleanGuidance, componentLabel as label, COMPONENTS, COMPONENT_IDS, DEFAULT_PUBLISH, defaultRunConfig, EFFORT_LEVELS, EFFORT_TABLE, isEffort, isSupervision, PAUSE_KEYS, PUBLISH_MERGE_METHODS, PUBLISH_MERGE_WHEN, SUPERVISION_LEVELS } from "./components.js";
import { DOMAIN_ID } from "./domains.js";
import { isObj } from "./util.js";

export const ENGINE_LABEL: Record<EngineId | "replay", string> = { anthropic: "Direct API", "claude-code": "Claude Code", replay: "Replay" };

const ROLE_IDS: RunRoleId[] = ["planner", "builder", "evaluator", "classifier", "scout"];
const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const MODES: GuardrailMode[] = ["ask", "auto", "trust"];
const CONTEXT_KEYS = ["compactAtTokens", "clearToolResultsAfterTurns", "resetAtTokens"] as const;
const NUMBER_KEYS = ["budgetUsd", "budgetTokens", "maxTurnsPerPhase", "maxFixRounds"] as const;

/** The model and effort a role runs with. The librarian (and any role a config does not name) borrows the planner's. */
export function roleSettings(config: RunConfig, role: RoleId): RoleSettings {
  return config.roles[role as RunRoleId] ?? config.roles.planner;
}

export const PAUSE_LABEL: Record<(typeof PAUSE_KEYS)[number], string> = {
  afterPlan: "Pause after the plan",
  afterContract: "Pause to approve the contract",
  beforeCommit: "Pause before each commit",
  afterEvaluation: "Pause after each evaluation",
  beforePublish: "Pause before publishing",
  beforeMerge: "Pause before each merge",
};

// ---- Config checker -------------------------------------------------------

/**
 * Settings that contradict each other or will be ignored. Never throws, even
 * on a legacy or partial config (missing pauses, context, components...).
 * Warnings never block a run; they are shown in New run and Harness and
 * written to the run log as notes at run start.
 */
export function checkRunConfig(config: unknown): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  if (!isObj(config)) return out;
  const comps: Record<string, unknown> = isObj(config.components) ? config.components : {};
  const onRaw = (id: ComponentId) => (typeof comps[id] === "boolean" ? (comps[id] as boolean) : COMPONENTS.find((c) => c.id === id)?.defaultOn ?? false);
  const engine: EngineId | null = config.engine === "claude-code" || config.engine === "anthropic" ? (config.engine as EngineId) : config.engine === "replay" ? null : "anthropic";

  // Components the engine does not honour follow the engine (resolved off on it), so there is no
  // "on but ignored" warning any more: engine support is not a choice.
  const ignoredHere = (id: ComponentId) => !!engine && !COMPONENTS.find((c) => c.id === id)!.engines.includes(engine);
  const on = (id: ComponentId) => !ignoredHere(id) && onRaw(id);

  // (b) unmet requires
  for (const c of COMPONENTS) {
    if (!on(c.id)) continue;
    for (const r of c.requires ?? []) {
      if (!on(r.id)) out.push({ level: "warn", component: c.id, message: `${c.label} needs ${label(r.id)}, which is off: ${r.reason}` });
    }
  }

  // (c) settings that do nothing
  const pauses: Record<string, unknown> = isObj(config.pauses) ? config.pauses : {};
  const fix = config.maxFixRounds;
  if (!on("evaluator") && typeof fix === "number" && fix > 0)
    out.push({ level: "warn", component: "evaluator", setting: "maxFixRounds", message: `Fix rounds (maxFixRounds = ${fix}) do nothing with the ${label("evaluator")} off: there is no evaluation to fail. Set them to 0 or turn the evaluator on.` });
  if (!on("evaluator") && pauses.afterEvaluation === true)
    out.push({ level: "warn", component: "evaluator", setting: "pauses.afterEvaluation", message: `${PAUSE_LABEL.afterEvaluation} (pauses.afterEvaluation) does nothing with the ${label("evaluator")} off: the evaluate phase never runs.` });
  if (!on("contracts") && pauses.afterContract === true)
    out.push({ level: "warn", component: "contracts", setting: "pauses.afterContract", message: `${PAUSE_LABEL.afterContract} (pauses.afterContract) does nothing with ${label("contracts")} off: there is no contract to approve.` });
  if (!on("planner") && pauses.afterPlan === true)
    out.push({ level: "warn", component: "planner", setting: "pauses.afterPlan", message: `${PAUSE_LABEL.afterPlan} (pauses.afterPlan) does nothing with the ${label("planner")} off: there is no plan phase.` });
  if (!on("publish") && pauses.beforePublish === true)
    out.push({ level: "warn", component: "publish", setting: "pauses.beforePublish", message: `${PAUSE_LABEL.beforePublish} (pauses.beforePublish) does nothing with ${label("publish")} off: no branch is pushed and no pull request is opened.` });
  if (!on("publish") && pauses.beforeMerge === true)
    out.push({ level: "warn", component: "publish", setting: "pauses.beforeMerge", message: `${PAUSE_LABEL.beforeMerge} (pauses.beforeMerge) does nothing with ${label("publish")} off: no pull request is opened or merged.` });
  if (!on("gitCommits") && pauses.beforeCommit === true)
    out.push({ level: "warn", component: "gitCommits", setting: "pauses.beforeCommit", message: `${PAUSE_LABEL.beforeCommit} (pauses.beforeCommit) does nothing with ${label("gitCommits")} off: the harness never commits.` });
  const mode = isObj(config.guardrail) ? config.guardrail.mode : undefined;
  if (on("actionClassifier") && (mode === "ask" || mode === "trust"))
    out.push({ level: "info", component: "actionClassifier", setting: "guardrail.mode", message: `${label("actionClassifier")} is only consulted in auto guardrail mode; in ${mode} mode it is not used.` });

  // (d) suspicious numbers
  const ctx = isObj(config.context) ? config.context : null;
  if (ctx && typeof ctx.resetAtTokens === "number" && typeof ctx.compactAtTokens === "number" && ctx.resetAtTokens <= ctx.compactAtTokens)
    out.push({ level: "warn", setting: "context.resetAtTokens", message: `Reset at ${ctx.resetAtTokens.toLocaleString("en-US")} tokens is not above compact at ${ctx.compactAtTokens.toLocaleString("en-US")} (context.resetAtTokens <= context.compactAtTokens): the reset would fire before compaction ever helps.` });
  if (typeof config.budgetUsd === "number" && config.budgetUsd < 1 && engine !== "claude-code")
    out.push({ level: "warn", setting: "budgetUsd", message: `A budget of $${config.budgetUsd} (budgetUsd < 1) stops most runs during planning.` });
  // On Claude Code the budget is tokens (usage counts against the subscription); a dollar figure someone set is not applied.
  if (engine === "claude-code" && typeof config.budgetUsd === "number" && isEffort(config.effort) && config.budgetUsd !== EFFORT_TABLE[config.effort].budgetUsd) {
    const tokens = typeof config.budgetTokens === "number" ? config.budgetTokens : EFFORT_TABLE[config.effort].budgetTokens;
    out.push({ level: "info", setting: "budgetUsd", message: `A dollar budget ($${config.budgetUsd}) is not applied on Claude Code: usage counts against the Claude subscription, so the cap is ${tokens.toLocaleString("en-US")} tokens (budgetTokens).` });
  }
  if (typeof config.budgetTokens === "number" && config.budgetTokens < 10_000 && engine === "claude-code")
    out.push({ level: "warn", setting: "budgetTokens", message: `A token budget of ${config.budgetTokens.toLocaleString("en-US")} (budgetTokens < 10,000) stops most runs during planning.` });
  if (typeof config.maxTurnsPerPhase === "number" && config.maxTurnsPerPhase < 5)
    out.push({ level: "warn", setting: "maxTurnsPerPhase", message: `${config.maxTurnsPerPhase} turns per phase (maxTurnsPerPhase < 5) is rarely enough to read, edit and verify anything.` });
  return out;
}

// ---- Presets --------------------------------------------------------------
// The care profiles (Full, Minimal, Careful) and the Claude Code preset are retired:
// a run is composed from Effort + Supervision + domains (shared/presets.ts composeRun).
// Their names stay reserved so a saved preset cannot shadow a migrated default.

export const RETIRED_PRESET_NAMES = ["Full", "Minimal", "Careful", "Claude Code"];

export function isBuiltInPresetName(name: string): boolean {
  return RETIRED_PRESET_NAMES.some((n) => n.toLowerCase() === name.trim().toLowerCase());
}

/** Always-tier components a config turns off, other than the listed ablations. */
export function alwaysTierOffs(components: Partial<Record<string, unknown>> | undefined, ablated: string[] = []): ComponentId[] {
  return COMPONENTS.filter((c) => c.tier === "always" && components?.[c.id] === false && !ablated.includes(c.id)).map((c) => c.id);
}

/**
 * Apply a preset over a base config. The base keeps its task, workspace, id,
 * title and createdAt; nested objects are merged, so a partial preset only
 * changes what it names. The result records the preset's name.
 */
export function applyPreset(base: RunConfig, preset: Pick<Preset, "name" | "config">): RunConfig {
  const p = preset.config ?? {};
  const roles = { ...base.roles };
  for (const r of ROLE_IDS) if (p.roles?.[r]) roles[r] = { ...roles[r], ...p.roles[r] };
  return {
    ...base,
    ...(p.engine ? { engine: p.engine } : {}),
    ...(typeof p.budgetUsd === "number" ? { budgetUsd: p.budgetUsd } : {}),
    ...(typeof p.budgetTokens === "number" ? { budgetTokens: p.budgetTokens } : {}),
    ...(typeof p.maxTurnsPerPhase === "number" ? { maxTurnsPerPhase: p.maxTurnsPerPhase } : {}),
    ...(typeof p.maxFixRounds === "number" ? { maxFixRounds: p.maxFixRounds } : {}),
    roles,
    components: { ...base.components, ...(p.components ?? {}) } as RunConfig["components"],
    pauses: { ...base.pauses, ...(p.pauses ?? {}) },
    context: { ...base.context, ...(p.context ?? {}) },
    guardrail: { ...base.guardrail, ...(p.guardrail ?? {}) },
    publish: { ...(base.publish ?? DEFAULT_PUBLISH), ...(p.publish ?? {}) },
    ...(Array.isArray(p.guidance) ? { guidance: [...p.guidance] } : base.guidance ? { guidance: [...base.guidance] } : {}),
    task: base.task,
    workspace: base.workspace,
    id: base.id,
    title: base.title,
    createdAt: base.createdAt,
    preset: preset.name,
  };
}

/** The preset-able part of a full config, e.g. for "Save as preset…". */
export function presetFromConfig(cfg: RunConfig): PresetConfig {
  return { engine: cfg.engine === "replay" ? undefined : cfg.engine, components: { ...cfg.components }, roles: structuredCloneSafe(cfg.roles), pauses: { ...cfg.pauses }, context: { ...cfg.context }, guardrail: { ...cfg.guardrail }, budgetUsd: cfg.budgetUsd, ...(typeof cfg.budgetTokens === "number" ? { budgetTokens: cfg.budgetTokens } : {}), maxTurnsPerPhase: cfg.maxTurnsPerPhase, maxFixRounds: cfg.maxFixRounds, ...(cfg.guidance?.length ? { guidance: [...cfg.guidance] } : {}) };
}
function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export interface ConfigChange {
  /** Dotted path, e.g. components.planner or pauses.afterContract. */
  path: string;
  label: string;
  from: string;
  to: string;
  /** Human-readable line, e.g. "Planner: off (default on)". */
  text: string;
}

/** What differs from defaultRunConfig(), field by field. Tolerates partial configs. */
export function diffFromDefaults(config: Partial<RunConfig>): ConfigChange[] {
  const d = defaultRunConfig({ task: "", workspace: "" });
  const out: ConfigChange[] = [];
  const push = (path: string, lbl: string, from: unknown, to: unknown) => {
    const f = fmt(from);
    const t = fmt(to);
    if (f !== t) out.push({ path, label: lbl, from: f, to: t, text: `${lbl}: ${t} (default ${f})` });
  };
  if (config.engine && config.engine !== d.engine) push("engine", "Engine", ENGINE_LABEL[d.engine], ENGINE_LABEL[config.engine] ?? config.engine);
  for (const c of COMPONENTS) {
    const v = config.components?.[c.id];
    if (typeof v === "boolean") push(`components.${c.id}`, c.label, c.defaultOn ? "on" : "off", v ? "on" : "off");
  }
  for (const r of ROLE_IDS) {
    const v = config.roles?.[r];
    if (v?.model) push(`roles.${r}.model`, `${cap(r)} model`, d.roles[r].model, v.model);
    if (v?.effort) push(`roles.${r}.effort`, `${cap(r)} effort`, d.roles[r].effort, v.effort);
  }
  for (const k of PAUSE_KEYS) if (typeof config.pauses?.[k] === "boolean") push(`pauses.${k}`, PAUSE_LABEL[k], d.pauses[k] ? "on" : "off", config.pauses[k] ? "on" : "off");
  for (const k of CONTEXT_KEYS) if (typeof config.context?.[k] === "number") push(`context.${k}`, `Context ${k}`, d.context[k], config.context[k]);
  const g = config.guardrail;
  if (g) {
    if (g.mode) push("guardrail.mode", "Guardrail mode", d.guardrail.mode, g.mode);
    if (typeof g.allowNetwork === "boolean") push("guardrail.allowNetwork", "Allow network", d.guardrail.allowNetwork ? "on" : "off", g.allowNetwork ? "on" : "off");
    for (const k of ["allowPatterns", "askPatterns", "denyPatterns"] as const) if (Array.isArray(g[k])) push(`guardrail.${k}`, `Guardrail ${k}`, (d.guardrail[k] ?? []).join(", ") || "none", g[k]!.join(", ") || "none");
  }
  if (Array.isArray(config.guidance) && config.guidance.length) {
    const n = config.guidance.length;
    out.push({ path: "guidance", label: "Run guidance", from: "none", to: `${n} line${n === 1 ? "" : "s"}`, text: `Run guidance: ${n} line${n === 1 ? "" : "s"} (default none)` });
  }
  for (const k of NUMBER_KEYS) if (typeof config[k] === "number") push(k, k === "budgetUsd" ? "Budget (USD)" : k === "budgetTokens" ? "Budget (tokens, Claude Code)" : k === "maxTurnsPerPhase" ? "Max turns per phase" : "Fix rounds", d[k], config[k]);
  return out;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmt = (v: unknown) => (typeof v === "number" ? String(v) : String(v ?? ""));

// ---- Validation of user presets -------------------------------------------

export const FORBIDDEN_PRESET_KEYS = ["task", "workspace", "id", "createdAt"] as const;

/** A one-line, actionable reason the body was rejected. */
export class PresetValidationError extends Error {}

/**
 * Keep only known keys and component ids; report what was dropped. A field of
 * the wrong type is an error, not a silent drop, so a typo in a value is seen.
 */
export function validatePresetConfig(raw: unknown, opts: { legacy?: boolean } = {}): { config: PresetConfig; dropped: string[] } {
  if (!isObj(raw)) throw new PresetValidationError("config must be a JSON object, e.g. {\"components\":{\"planner\":false}}");
  const dropped: string[] = [];
  const config: PresetConfig = {};
  const bad = (field: string, want: string) => {
    throw new PresetValidationError(`${field} must be ${want}`);
  };
  for (const [k, v] of Object.entries(raw)) {
    switch (k) {
      case "engine":
        if (v !== "anthropic" && v !== "claude-code") bad("engine", '"anthropic" or "claude-code"');
        config.engine = v as EngineId;
        break;
      case "budgetUsd":
      case "budgetTokens":
      case "maxTurnsPerPhase":
      case "maxFixRounds":
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) bad(k, "a non-negative number");
        config[k] = v as number;
        break;
      case "components": {
        if (!isObj(v)) bad("components", "an object of component id to true/false");
        const c: Partial<Record<ComponentId, boolean>> = {};
        for (const [id, on] of Object.entries(v as object)) {
          if (!(COMPONENT_IDS as string[]).includes(id)) {
            dropped.push(`components.${id}`);
            continue;
          }
          if (typeof on !== "boolean") bad(`components.${id}`, "true or false");
          if (on === false && COMPONENTS.find((x) => x.id === id)?.tier === "always") {
            // Always-tier: on at every effort. A legacy entry's false is dropped; a new one is refused.
            if (opts.legacy) {
              dropped.push(`components.${id} (always on)`);
              continue;
            }
            throw new PresetValidationError(`components.${id} is always on and cannot be turned off in a preset (run an ablation experiment, POST /api/runs with ablated, to run without ${label(id as ComponentId)})`);
          }
          c[id as ComponentId] = on as boolean;
        }
        config.components = c;
        break;
      }
      case "roles": {
        if (!isObj(v)) bad("roles", "an object keyed by role");
        const roles: PresetConfig["roles"] = {};
        for (const [r, s] of Object.entries(v as object)) {
          if (!(ROLE_IDS as string[]).includes(r)) {
            dropped.push(`roles.${r}`);
            continue;
          }
          if (!isObj(s)) bad(`roles.${r}`, "an object with model and/or effort");
          const out: { model?: string; effort?: EffortLevel } = {};
          for (const [sk, sv] of Object.entries(s as object)) {
            if (sk === "model") {
              if (typeof sv !== "string" || !sv.trim()) bad(`roles.${r}.model`, "a model id string");
              out.model = (sv as string).trim().slice(0, 80);
            } else if (sk === "effort") {
              if (!EFFORTS.includes(sv as EffortLevel)) bad(`roles.${r}.effort`, `one of ${EFFORTS.join(", ")}`);
              out.effort = sv as EffortLevel;
            } else dropped.push(`roles.${r}.${sk}`);
          }
          roles[r as RoleId] = out;
        }
        config.roles = roles;
        break;
      }
      case "pauses": {
        if (!isObj(v)) bad("pauses", "an object of pause name to true/false");
        const p: PresetConfig["pauses"] = {};
        for (const [pk, pv] of Object.entries(v as object)) {
          if (!(PAUSE_KEYS as readonly string[]).includes(pk)) {
            dropped.push(`pauses.${pk}`);
            continue;
          }
          if (typeof pv !== "boolean") bad(`pauses.${pk}`, "true or false");
          (p as any)[pk] = pv;
        }
        config.pauses = p;
        break;
      }
      case "context": {
        if (!isObj(v)) bad("context", "an object of token thresholds");
        const c: PresetConfig["context"] = {};
        for (const [ck, cv] of Object.entries(v as object)) {
          if (!(CONTEXT_KEYS as readonly string[]).includes(ck)) {
            dropped.push(`context.${ck}`);
            continue;
          }
          if (typeof cv !== "number" || !Number.isFinite(cv) || cv < 0) bad(`context.${ck}`, "a non-negative number");
          (c as any)[ck] = cv;
        }
        config.context = c;
        break;
      }
      case "guardrail": {
        if (!isObj(v)) bad("guardrail", "an object");
        const g: PresetConfig["guardrail"] = {};
        for (const [gk, gv] of Object.entries(v as object)) {
          if (gk === "mode") {
            if (!MODES.includes(gv as GuardrailMode)) bad("guardrail.mode", `one of ${MODES.join(", ")}`);
            g.mode = gv as GuardrailMode;
          } else if (gk === "allowNetwork") {
            if (typeof gv !== "boolean") bad("guardrail.allowNetwork", "true or false");
            g.allowNetwork = gv as boolean;
          } else if (gk === "allowPatterns" || gk === "askPatterns" || gk === "denyPatterns") {
            if (!Array.isArray(gv) || gv.some((x) => typeof x !== "string")) bad(`guardrail.${gk}`, "an array of regex strings");
            g[gk] = (gv as string[]).slice(0, 50);
          } else dropped.push(`guardrail.${gk}`);
        }
        config.guardrail = g;
        break;
      }
      case "publish": {
        if (!isObj(v)) bad("publish", "an object (remote, base, mergeWhen, mergeMethod, pollSeconds, maxWaitMinutes, maxReviewRounds)");
        const pub: Partial<PublishPolicy> = {};
        for (const [pk, pv] of Object.entries(v as object)) {
          if (pk === "remote" || pk === "base") {
            if (typeof pv !== "string" || !pv.trim()) bad(`publish.${pk}`, "a non-empty string");
            pub[pk] = (pv as string).trim().slice(0, 120);
          } else if (pk === "mergeWhen") {
            if (!PUBLISH_MERGE_WHEN.includes(pv as PublishPolicy["mergeWhen"])) bad("publish.mergeWhen", `one of ${PUBLISH_MERGE_WHEN.join(", ")}`);
            pub.mergeWhen = pv as PublishPolicy["mergeWhen"];
          } else if (pk === "mergeMethod") {
            if (!PUBLISH_MERGE_METHODS.includes(pv as PublishPolicy["mergeMethod"])) bad("publish.mergeMethod", `one of ${PUBLISH_MERGE_METHODS.join(", ")}`);
            pub.mergeMethod = pv as PublishPolicy["mergeMethod"];
          } else if (pk === "pollSeconds" || pk === "maxWaitMinutes" || pk === "maxReviewRounds") {
            if (typeof pv !== "number" || !Number.isFinite(pv) || pv < 0) bad(`publish.${pk}`, "a non-negative number");
            pub[pk] = pv as number;
          } else dropped.push(`publish.${pk}`);
        }
        config.publish = pub;
        break;
      }
      case "effort":
        if (!isEffort(v)) bad("effort", `one of ${EFFORT_LEVELS.join(", ")}`);
        config.effort = v as HarnessEffort;
        break;
      case "supervision":
        if (!isSupervision(v)) bad("supervision", `one of ${SUPERVISION_LEVELS.join(", ")}`);
        config.supervision = v as Supervision;
        break;
      case "domains":
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !DOMAIN_ID.test(x))) bad("domains", "an array of domain ids, e.g. [\"golang\",\"cli\"]");
        config.domains = [...new Set(v as string[])].slice(0, 12);
        break;
      case "guidance": {
        if (!Array.isArray(v)) bad("guidance", "an array of one-line strings");
        const g = cleanGuidance(v as unknown[]);
        dropped.push(...g.dropped);
        config.guidance = g.lines;
        break;
      }
      default:
        dropped.push(k);
    }
  }
  return { config, dropped };
}

/** Preset names are labels, never paths: letters, digits, space, _ . - only, no leading dots. */
export function sanitizePresetName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[^A-Za-z0-9 _.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.\-]+|[\s.\-]+$/g, "")
    .slice(0, 60)
    .trim();
}
