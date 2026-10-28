// One starting-point model for New run, Harness and Lessons. Pure: vitest runs it in node.
//
// GET /api/presets returns presets generated from lessons (Web app, CLI / tool, Go, Python, ...)
// and the user's own saved presets. A run starts from Effort + Supervision + domains; the
// retired care profiles (Full, Minimal, Careful) and "Claude Code" are only read, as names
// in old defaults and runs, and mapped onto a composition by startingPointFor().
import type { EngineId, HarnessEffort, Preset, Supervision } from "@shared/types";
import { compositionLabel, generatedPresets, parseComposition, PRESET_RECIPES, type PresetRecipe } from "@shared/presets";
import { EFFORT_TABLE, PAUSE_KEYS, SUPERVISION_TABLE, type PauseKey } from "@shared/components";

type Listed = Pick<Preset, "name" | "builtIn"> & Partial<Pick<Preset, "id" | "layer" | "generated" | "domain">>;

export interface ClassifiedPresets<P extends Listed> {
  /** Presets generated from lessons, one per domain. */
  domains: P[];
  /** The user's own presets: the only things the Saved preset select lists. */
  saved: P[];
}

/** Split the /api/presets list. Built-ins that are not a domain (the retired profiles) go nowhere. */
export function classifyPresets<P extends Listed>(list: P[]): ClassifiedPresets<P> {
  const domains: P[] = [];
  const saved: P[] = [];
  for (const p of list) {
    if (p.generated || (p.builtIn && p.domain)) domains.push(p);
    else if (!p.builtIn) saved.push(p);
  }
  return { domains, saved };
}

/** The options startingPointFor needs: saved preset names and generated preset names with their domains. */
export type StartingPointOptions = NonNullable<Parameters<typeof startingPointFor>[1]>;

/**
 * The preset list as New run and Harness read it: the store's (or, before it loads, the
 * recipes' generated presets), split into saved and domain presets, with startingPointFor's options.
 */
export function presetOptions<P extends Preset>(stored: P[]): ClassifiedPresets<P | Preset> & { options: StartingPointOptions } {
  const { saved, domains } = classifyPresets<P | Preset>(stored.length ? stored : generatedPresets([]));
  return { saved, domains, options: { saved: saved.map((p) => p.name), generated: domains.map((p) => ({ name: p.name, domain: p.domain })) } };
}

export type StartingPoint =
  /** Effort + Supervision + domains; `engine` when the old name implied one. */
  | { kind: "compose"; effort: HarnessEffort; supervision: Supervision; domains: string[]; engine?: EngineId }
  /** One of the user's saved presets, by its exact name. */
  | { kind: "saved"; name: string }
  /** Nothing we recognise: start from the settings as they are. */
  | { kind: "custom" };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Map a preset name onto the starting-point model (migration on read):
 * - "Full" -> medium + check-in; "Minimal" -> low + unattended; "Careful" -> high + ask every write;
 * - a generated name ("Web app", "CLI / tool", "Go") -> medium + check-in + that domain;
 * - "Claude Code" -> medium + check-in on the claude-code engine;
 * - a chip label ("Careful · Web", "High · Check in · Go") -> that composition;
 * - one of `saved` -> that saved preset; anything else -> custom. Never throws.
 * A trailing " (modified)" (how runs record an edited preset) is ignored.
 */
export function startingPointFor(name: string | null | undefined, opts: { saved?: string[]; generated?: { name: string; domain?: string }[] } = {}): StartingPoint {
  if (typeof name !== "string" || !name.trim()) return { kind: "custom" };
  const raw = name.replace(/\s*\(modified\)\s*$/i, "");
  const n = norm(raw);
  const savedHit = (opts.saved ?? []).find((s) => norm(s) === n);
  if (savedHit) return { kind: "saved", name: savedHit };
  const recipes: PresetRecipe[] = [...PRESET_RECIPES, ...(opts.generated ?? []).filter((g) => g.domain && !PRESET_RECIPES.some((r) => r.id === g.domain)).map((g) => ({ id: g.domain!, name: g.name, description: "", guidance: [] }))];
  const { composition, recognised } = parseComposition(raw, recipes);
  if (!recognised) return { kind: "custom" };
  return { kind: "compose", effort: composition.effort, supervision: composition.supervision, domains: composition.domains, ...(composition.engine ? { engine: composition.engine } : {}) };
}

/** One line saying what a run starts from, e.g. "High · Check in · Web" or "your saved preset “mine”". */
export function describeStart(sp: StartingPoint): string {
  if (sp.kind === "saved") return `your saved preset “${sp.name}”`;
  if (sp.kind === "compose") return compositionLabel(sp);
  return "custom settings";
}

// ---- Plain-words summaries for the Harness page ----------------------------

export interface EffortSummary {
  /** The pipeline stages that run at this effort, in order. */
  stages: string[];
  /** Effort-tier extras beyond the stages (scouts, task budget, think tool, max's re-run rule). */
  extras: string[];
  fixRounds: number;
  turns: number;
  /** The cap on the direct API engine. */
  budgetUsd: number;
  /** The cap on Claude Code, where usage counts against the subscription. */
  budgetTokens: number;
}

/** What an Effort level turns on, as a person reads it: stages, extras, fix rounds, turns and budget. */
export function effortSummary(effort: HarnessEffort): EffortSummary {
  const row = EFFORT_TABLE[effort];
  const on = row.components;
  const stages = [on.planner ? "Plan" : "", on.planner ? "Breakdown" : "", on.contracts ? "Contract" : "", "Tests", "Build", on.evaluator ? "Evaluate" : "", "Publish"].filter(Boolean);
  const extras = [on.scouts ? "Scout subagents" : "", on.taskBudget ? "Task budget" : "", on.thinkTool ? "Think tool" : "", row.rerunEveryCriterion ? "Evaluator re-runs every criterion" : ""].filter(Boolean);
  return { stages, extras, fixRounds: row.maxFixRounds, turns: row.maxTurnsPerPhase, budgetUsd: row.budgetUsd, budgetTokens: row.budgetTokens };
}

const PAUSE_WORDS: Record<PauseKey, string> = { afterPlan: "after the plan", afterContract: "to approve each contract", beforeCommit: "before each commit", afterEvaluation: "after each evaluation", beforePublish: "before publishing each package", beforeReviewRound: "when review feedback arrives", beforeReviewReply: "before each reply to reviewers", beforeMerge: "before each merge" };

/** The pauses a Supervision level turns on, in pipeline order. */
export function supervisionSummary(supervision: Supervision): string[] {
  const p = SUPERVISION_TABLE[supervision].pauses;
  return PAUSE_KEYS.filter((k) => p[k]).map((k) => PAUSE_WORDS[k]);
}
