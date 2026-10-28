import type { ComponentId, ComponentTier, Foundation, GuardrailMode, HarnessComponent, HarnessEffort, PublishPolicy, RunConfig, RunSummary, Supervision, Trial, TrialSet } from "./types.js";

export const HARNESS_VERSION = "0.2.0";

/**
 * Every harness component encodes an assumption about what the model cannot
 * yet do alone. Those assumptions go stale as models improve, so each one is a
 * switch, carries its assumption in words, and points at the lesson that
 * justified it. Remove one at a time and watch what breaks.
 */
export const COMPONENTS: HarnessComponent[] = [
  {
    id: "planner",
    label: "Planner",
    short: "Expand a short task into a spec before building.",
    whenOff: "The task text itself is written to .reins/spec.md as the spec; there is no plan phase and no planner-made feature list.",
    engines: ["anthropic", "claude-code"],
    assumption: "Given a 1-4 sentence task the builder under-scopes or skips features.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "effort",
  },
  {
    id: "workPackages",
    label: "Work packages",
    short: "After the plan, the planner slices the feature list into pull-request-sized packages; contract, build and evaluate run once per package, in order.",
    whenOff: "No breakdown phase: the feature list is built as one package, so one contract covers the whole run and a pull request would be as big as the task. (With the planner off there is no feature list to slice, so the run is one package as well.)",
    engines: ["anthropic", "claude-code"],
    assumption: "A change a reviewer can read in one sitting gets reviewed; a task-sized change gets rubber-stamped or abandoned.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "always",
  },
  {
    id: "contracts",
    label: "Sprint contracts",
    short: "Builder and evaluator agree what 'done' means and how to verify it before any code is written.",
    whenOff: "No contract phase: the run is held to one generic criterion (\"the task as described is complete and verified by running the result\").",
    engines: ["anthropic", "claude-code"],
    assumption: "Without an agreed definition of done the builder declares victory early.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "effort",
  },
  {
    id: "testsFirst",
    label: "Tests first",
    short: "After the contract, a test writer encodes each criterion as a test that must fail before the build, explains every test in .reins/tests.md, and making the suite pass becomes a hard criterion.",
    whenOff: "No tests phase: the builder writes whatever tests it chooses while building, and only the contract's own verification steps are checked.",
    engines: ["anthropic", "claude-code"],
    assumption: "A builder that writes its own tests after the code tests what it built, not what was asked; tests written first from the contract pin the requirement.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "always",
  },
  {
    id: "publish",
    label: "Publish as pull requests",
    short: "Each package is built on its own branch cut from the freshly pulled base; once it passes evaluation the harness pushes, opens a pull request, waits for approval and green checks, merges, and pulls the base before the next package.",
    whenOff: "No publish phase and no pull request: packages are built and committed one after another on the current branch, and nothing is pushed.",
    engines: ["anthropic", "claude-code"],
    assumption: "A change nobody reviews and merges is not done; the harness, not a person, should carry a finished package to a merged pull request.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "always",
  },
  {
    id: "evaluator",
    label: "Skeptical evaluator",
    short: "A separate agent checks every contract criterion against the live result.",
    whenOff: "No evaluate phase and no contract review: nobody but the builder checks the result, and fix rounds never run.",
    engines: ["anthropic", "claude-code"],
    assumption: "Agents overrate their own output; a standalone evaluator is easier to make skeptical.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "effort",
  },
  {
    id: "scouts",
    label: "Scout subagents",
    short: "The builder can delegate a research question to a short-lived read-only subagent that returns a summary, not its transcript.",
    whenOff: "delegate_scout is not offered, so the builder explores the codebase in its own context window.",
    engines: ["anthropic"],
    assumption: "Exploring a codebase in the main conversation pollutes it with tool output that is never needed again.",
    lessons: [],
    defaultOn: true,
    group: "roles",
    tier: "effort",
  },
  {
    id: "featureList",
    label: "Feature list (features.json)",
    short: "A structured feature list the agent must not delete from, only mark done.",
    whenOff: "Features are still tracked in the run log, but .reins/features.json is not written, so the next session cannot re-read what remains.",
    engines: ["anthropic", "claude-code"],
    assumption: "Over long work the agent loses track of what remains and prematurely declares completion.",
    lessons: [],
    defaultOn: true,
    group: "memory",
    tier: "always",
  },
  {
    id: "progressFile",
    label: "Progress notes (progress.md)",
    short: "Structured note-taking outside the context window, re-read at the start of every session.",
    whenOff: "update_progress notes are not appended to .reins/progress.md, so the next session (and a reset) starts without them.",
    engines: ["anthropic", "claude-code"],
    assumption: "The next session starts with zero memory of this one.",
    lessons: [],
    defaultOn: true,
    group: "memory",
    tier: "always",
  },
  {
    id: "projectMemory",
    label: "Project memory (CLAUDE.md)",
    short: "The workspace's CLAUDE.md (and AGENTS.md) is handed to every role as the project's own instructions.",
    whenOff: "CLAUDE.md and AGENTS.md are not handed to the roles; they rediscover the project's conventions by reading the repo.",
    engines: ["anthropic", "claude-code"],
    assumption: "Conventions that live in the repo are cheaper to read once than to rediscover every session.",
    lessons: [],
    defaultOn: true,
    group: "memory",
    tier: "always",
  },
  {
    id: "gitCommits",
    label: "Commit per phase",
    short: "Leave the repo in a clean, committed state at each phase boundary.",
    whenOff: "No commit at phase boundaries, the git_commit tool is hidden and the agents are told not to commit.",
    engines: ["anthropic", "claude-code"],
    assumption: "A half-finished uncommitted change confuses the next session.",
    lessons: [],
    defaultOn: true,
    group: "memory",
    tier: "always",
  },
  {
    id: "compaction",
    label: "Compaction",
    short: "Summarize old history in place when the prompt grows past a threshold.",
    whenOff: "Old history is never summarised; a long phase grows until it hits the turn cap or the context limit.",
    engines: ["anthropic"],
    assumption: "The task outlives a single context window.",
    lessons: [],
    defaultOn: true,
    group: "context",
    tier: "always",
  },
  {
    id: "contextEditing",
    label: "Clear stale tool results",
    short: "Drop old tool outputs from the prompt without summarizing them.",
    whenOff: "Old tool results stay in the prompt verbatim for the rest of the phase.",
    engines: ["anthropic"],
    assumption: "Most tool output is only useful for a turn or two.",
    lessons: [],
    defaultOn: true,
    group: "context",
    tier: "always",
  },
  {
    id: "resetWithHandoff",
    label: "Reset with handoff",
    short: "Start a fresh conversation from a written handoff when the context is nearly full.",
    whenOff: "The builder keeps one conversation across fix rounds, however long it gets.",
    engines: ["anthropic", "claude-code"],
    requires: [{ id: "progressFile", reason: "The handoff is read from .reins/progress.md, which is only written when progress notes are on." }],
    assumption: "The model gets 'context anxiety' and wraps up early as the window fills.",
    lessons: [],
    defaultOn: true,
    group: "context",
    tier: "always",
  },
  {
    id: "taskBudget",
    label: "Task budget (time awareness)",
    short: "Tell the model how many tokens a phase may spend so it paces itself instead of being cut off.",
    whenOff: "The model is not told its token budget; it is only stopped by the turn cap and the dollar budget.",
    engines: ["anthropic"],
    assumption: "Agents are blind to elapsed time and budget unless the harness tells them.",
    lessons: [],
    defaultOn: true,
    group: "context",
    tier: "effort",
  },
  {
    id: "thinkTool",
    label: "Think tool",
    short: "A no-op tool that gives the model a place to stop and reason between tool calls.",
    whenOff: "The think tool is not offered and the prompt does not ask for explicit pauses between tool calls.",
    engines: ["anthropic", "claude-code"],
    assumption: "Long tool-call chains with policy constraints benefit from explicit pauses. The post's Dec 2025 update prefers native extended thinking on current models, so this is off by default.",
    lessons: [],
    defaultOn: false,
    group: "tools",
    tier: "effort",
  },
  {
    id: "toolSearch",
    label: "Tool search",
    short: "Keep rarely-used tools out of the prompt and load them on demand.",
    whenOff: "Every tool schema, including rarely used ones (git_*, lessons), is loaded into every prompt.",
    engines: ["anthropic"],
    assumption: "Every tool schema in context costs tokens and attention whether it is used or not.",
    lessons: [],
    defaultOn: true,
    group: "tools",
    tier: "always",
  },
  {
    id: "toolExamples",
    label: "Tool use examples",
    short: "Ship one realistic example call with the trickier tools so parameters are filled correctly.",
    whenOff: "Tools ship with their schema only, without an example call.",
    engines: ["anthropic"],
    assumption: "A schema alone under-specifies how to use a tool well.",
    lessons: [],
    defaultOn: true,
    group: "tools",
    tier: "always",
  },
  {
    id: "skills",
    label: "Skills (SKILL.md)",
    short: "Only skill names and one-line descriptions sit in the prompt; the body is read when a task calls for it.",
    whenOff: "No skills index in the prompt and no read_skill tool; installed skills are ignored.",
    engines: ["anthropic", "claude-code"],
    assumption: "Specialised know-how is cheaper to load on demand than to keep resident.",
    lessons: [],
    defaultOn: true,
    group: "tools",
    tier: "always",
  },
  {
    id: "selfVerification",
    label: "Self-verification",
    short: "The builder must run the contract's verification steps before calling finish.",
    whenOff: "The builder is not told to run the verification steps before finish; only the evaluator (if on) checks them.",
    engines: ["anthropic", "claude-code"],
    assumption: "Left alone the builder tests superficially.",
    lessons: [],
    defaultOn: true,
    group: "tools",
    tier: "always",
  },
  {
    id: "narration",
    label: "Plain-language narration",
    short: "Every tool call is rendered as a sentence a person can skim.",
    whenOff: "Nothing changes yet: tool calls are always narrated in the log. The switch is recorded with the run for ablation tracking.",
    engines: ["anthropic", "claude-code"],
    assumption: "Raw JSON transcripts are not read; unread transcripts hide failures.",
    lessons: [],
    defaultOn: true,
    group: "tools",
    tier: "always",
  },
  {
    id: "actionClassifier",
    label: "Action classifier",
    short: "Classify each risky shell command against the task instead of asking about everything.",
    whenOff: "In auto mode, ambiguous shell commands ask you instead of being settled by the classifier.",
    engines: ["anthropic", "claude-code"],
    assumption: "Permission prompts train people to click yes; a classifier that knows the task can decide most cases.",
    lessons: [],
    defaultOn: true,
    group: "safety",
    tier: "engine",
  },
  {
    id: "osSandbox",
    label: "OS sandbox (macOS)",
    short: "Run shell commands under a Seatbelt profile: writes only inside the workspace and temp, no network unless allowed.",
    whenOff: "Shell commands run without the Seatbelt profile; only the policy rules stand between the agent and the machine.",
    engines: ["anthropic", "claude-code"],
    assumption: "A persuadable model needs an environment-level boundary, not only a policy-level one.",
    lessons: [],
    defaultOn: true,
    group: "safety",
    tier: "always",
  },
  {
    id: "stageLessons",
    label: "Lessons for this stage",
    short: "Each phase's first message carries a short block of reviewed stage implications from the lesson library (at most 8 lines).",
    whenOff: "No \"Lessons for this stage\" block: the roles get only their fixed prompts and any run guidance.",
    engines: ["anthropic", "claude-code"],
    assumption: "The model does not recall the specific practice that applies at each stage unless it is put in front of it, briefly.",
    lessons: [],
    defaultOn: true,
    group: "context",
    tier: "always",
  },
];

/**
 * Decisions that are not switches but still come from the lessons. They are
 * listed so every post in the library is traceable to something concrete.
 */
export const FOUNDATIONS: Foundation[] = [
  {
    id: "eventLog",
    label: "Append-only event log",
    short: "A run is an immutable JSONL log; the UI, replay and the scrubber are folds over it. The session is not the context window.",
    lessons: [],
  },
  {
    id: "fileHandoff",
    label: "Roles hand off through files",
    short: "Planner, builder and evaluator never share a context window; they exchange spec, contract, progress and evaluation files under .reins/.",
    lessons: [],
  },
  {
    id: "ownedLoop",
    label: "The loop is owned, not borrowed",
    short: "The Messages API loop lives in the harness so every context, tool and safety step is visible and switchable.",
    lessons: [],
  },
  {
    id: "toolHygiene",
    label: "Tool results are capped and steerable",
    short: "Outputs are truncated head and tail with a hint to narrow; errors are one-line and actionable; edits are exact-match single-occurrence.",
    lessons: [],
  },
  {
    id: "secretsOutside",
    label: "Credentials never enter the sandbox",
    short: "API keys and tokens are stripped from the agent's shell environment; the harness holds them.",
    lessons: [],
  },
  {
    id: "untrustedOutput",
    label: "Tool output is attack surface",
    short: "Instruction-shaped text in tool results is flagged and wrapped as data; the classifier never sees the model's own prose.",
    lessons: [],
  },
  {
    id: "effectiveConfig",
    label: "Effective configuration is recorded",
    short: "Every run stores its full config, harness version, model, effort and environment, so a regression can be joined to what changed.",
    lessons: [],
  },
  {
    id: "cacheAsSignal",
    label: "Cache hit rate as a health signal",
    short: "A stable system prefix, mid-conversation operator notes instead of prompt edits, and the hit rate on the Context tab.",
    lessons: [],
  },
  {
    id: "reliability",
    label: "Reliability over single runs",
    short: "Runs of the same task group into trial sets with pass^k and pass@k, because one green run proves little.",
    lessons: [],
  },
  {
    id: "declarativeConfig",
    label: "One declarative run config",
    short: "A single typed config drives the form, the server and the record of the run, like a manifest with user_config.",
    lessons: [],
  },
  {
    id: "reviewIntent",
    label: "Review intent, not lines",
    short: "The contract and the evaluator's evidence are the review surface; diffs and commits are there when you want them.",
    lessons: [],
  },
];

/**
 * Component and foundation lesson lists are not hand-written: they are derived
 * from the implications that target them (shared/implications.ts linkCatalogue),
 * filled in when the lesson library loads.
 */
export const COMPONENT_IDS = COMPONENTS.map((c) => c.id) as ComponentId[];

/** A component's label for messages; the id itself when it is not in the catalogue. */
export const componentLabel = (id: string): string => COMPONENTS.find((c) => c.id === id)?.label ?? id;

export function defaultComponents(): Record<ComponentId, boolean> {
  const out = {} as Record<ComponentId, boolean>;
  for (const c of COMPONENTS) out[c.id] = c.defaultOn;
  return out;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01 },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", inputPerM: 10, outputPerM: 50, cacheReadPerM: 0.25 },
];

// ---- Effort and Supervision: the two dials of a run composition ------------
// The exact tables live here, once. The server, the web UI, docs generation
// (shared/docsTables.ts) and the tests all import them.

export const EFFORT_LEVELS: HarnessEffort[] = ["low", "medium", "high", "max"];
export const SUPERVISION_LEVELS: Supervision[] = ["unattended", "ask-to-publish", "check-in", "ask-every-write"];
export const DEFAULT_COMPOSITION: { effort: HarnessEffort; supervision: Supervision } = { effort: "medium", supervision: "check-in" };

/** The effort-tier components, in table order. */
export const EFFORT_COMPONENTS = ["planner", "contracts", "evaluator", "scouts", "taskBudget", "thinkTool"] as const satisfies readonly ComponentId[];
export type EffortComponentId = (typeof EFFORT_COMPONENTS)[number];

export interface EffortRow {
  label: string;
  /** One line a person understands, shown under the control in New run. */
  meaning: string;
  components: Record<EffortComponentId, boolean>;
  maxFixRounds: number;
  maxTurnsPerPhase: number;
  /** The cap on the direct API engine, where usage is billed per token. */
  budgetUsd: number;
  /** The cap on the Claude Code engine, where usage counts against the subscription: input + output + cache writes, cache reads at a tenth. */
  budgetTokens: number;
  /** Max only: the evaluator re-runs every criterion's verification afresh, and an incomplete report is refused. */
  rerunEveryCriterion: boolean;
}

const row = (label: string, meaning: string, on: string, maxFixRounds: number, maxTurnsPerPhase: number, budgetUsd: number, budgetTokens: number, rerunEveryCriterion = false): EffortRow => ({
  label,
  meaning,
  components: Object.fromEntries(EFFORT_COMPONENTS.map((id, i) => [id, on[i] === "1"])) as Record<EffortComponentId, boolean>,
  maxFixRounds,
  maxTurnsPerPhase,
  budgetUsd,
  budgetTokens,
  rerunEveryCriterion,
});

/** Columns of `on`: planner, contracts, evaluator, scouts, taskBudget, thinkTool. */
export const EFFORT_TABLE: Record<HarnessEffort, EffortRow> = {
  low: row("Low", "The builder alone, on a small budget: no plan, contract or evaluation.", "000000", 0, 30, 3, 300_000),
  medium: row("Medium", "Plan, build and evaluate once, with one fix round, on the default budget.", "101010", 1, 60, 10, 1_000_000),
  high: row("High", "Adds a negotiated contract and scouts, two fix rounds and a larger budget.", "111110", 2, 90, 20, 2_000_000),
  max: row("Max", "Everything, with the think tool, three fix rounds and the evaluator re-running every criterion.", "111111", 3, 120, 40, 4_000_000, true),
};

export type PauseKey = "afterPlan" | "afterContract" | "beforeCommit" | "afterEvaluation" | "beforePublish" | "beforeMerge";
export const PAUSE_KEYS: PauseKey[] = ["afterPlan", "afterContract", "beforeCommit", "afterEvaluation", "beforePublish", "beforeMerge"];
/** The gate each pause waits at: a pause turns on only when its gate exists at the chosen effort. */
export const PAUSE_GATE: Record<PauseKey, ComponentId> = { afterPlan: "planner", afterContract: "contracts", beforeCommit: "gitCommits", afterEvaluation: "evaluator", beforePublish: "publish", beforeMerge: "publish" };

export interface SupervisionRow {
  label: string;
  /** Text in the run title chip. */
  chip: string;
  meaning: string;
  pauses: Record<PauseKey, boolean>;
  mode: GuardrailMode;
  actionClassifier: boolean;
}

export const SUPERVISION_TABLE: Record<Supervision, SupervisionRow> = {
  unattended: { label: "Unattended", chip: "Unattended", meaning: "Never pauses; the guardrail runs in auto mode with the action classifier.", pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false, beforePublish: false, beforeMerge: false }, mode: "auto", actionClassifier: true },
  "ask-to-publish": { label: "Ask before publishing", chip: "Ask to publish", meaning: "Runs unattended until a package is ready to go out, then asks once before pushing its branch and opening the pull request; auto mode with the action classifier.", pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false, beforePublish: true, beforeMerge: false }, mode: "auto", actionClassifier: true },
  "check-in": { label: "Check in at gates", chip: "Check in", meaning: "Pauses after the plan, the contract, each evaluation, to review each pull request draft and before each merge; auto mode otherwise.", pauses: { afterPlan: true, afterContract: true, beforeCommit: false, afterEvaluation: true, beforePublish: true, beforeMerge: true }, mode: "auto", actionClassifier: true },
  "ask-every-write": { label: "Ask before every write", chip: "Ask every write", meaning: "Every pause is on and the guardrail asks before anything that is not read-only.", pauses: { afterPlan: true, afterContract: true, beforeCommit: true, afterEvaluation: true, beforePublish: true, beforeMerge: true }, mode: "ask", actionClassifier: false },
};

// ---- Publishing ------------------------------------------------------------

export const PUBLISH_MERGE_WHEN: PublishPolicy["mergeWhen"][] = ["approved", "checks", "never"];
export const PUBLISH_MERGE_METHODS: PublishPolicy["mergeMethod"][] = ["squash", "merge", "rebase"];
/** Wait for an approving review and green checks, squash, look every minute, give up after four hours. */
export const DEFAULT_PUBLISH: PublishPolicy = { remote: "origin", mergeWhen: "approved", mergeMethod: "squash", pollSeconds: 60, maxWaitMinutes: 240, maxReviewRounds: 3 };

export const TIER_LABEL: Record<ComponentTier, string> = { always: "Always on", effort: "Set by Effort", engine: "Follows settings" };

export const isEffort = (v: unknown): v is HarnessEffort => typeof v === "string" && (EFFORT_LEVELS as string[]).includes(v);
export const isSupervision = (v: unknown): v is Supervision => typeof v === "string" && (SUPERVISION_LEVELS as string[]).includes(v);
export function tierOf(id: string): ComponentTier | undefined {
  return COMPONENTS.find((c) => c.id === id)?.tier;
}
export const ALWAYS_IDS = (): ComponentId[] => COMPONENTS.filter((c) => c.tier === "always").map((c) => c.id);

export const CONTEXT_LIMIT_TOKENS = 1_000_000;

export function defaultRunConfig(partial: Partial<RunConfig> & { task: string; workspace: string }): RunConfig {
  const components = { ...defaultComponents(), ...(partial.components ?? {}) };
  return {
    id: partial.id ?? "",
    title: partial.title ?? partial.task.slice(0, 60),
    task: partial.task,
    workspace: partial.workspace,
    engine: partial.engine ?? "anthropic",
    roles: {
      planner: { model: DEFAULT_MODEL, effort: "high" },
      builder: { model: DEFAULT_MODEL, effort: "high" },
      evaluator: { model: DEFAULT_MODEL, effort: "high" },
      classifier: { model: "claude-haiku-5-5", effort: "low" },
      scout: { model: "claude-sonnet-5-5", effort: "medium" },
      ...(partial.roles ?? {}),
    },
    components,
    pauses: partial.pauses ?? { afterPlan: false, afterContract: true, beforeCommit: false, afterEvaluation: false, beforePublish: false, beforeMerge: true },
    context: partial.context ?? { compactAtTokens: 150_000, clearToolResultsAfterTurns: 8, resetAtTokens: 400_000 },
    guardrail: partial.guardrail ?? { mode: "auto", allowNetwork: false, askPatterns: [], denyPatterns: [] },
    budgetUsd: partial.budgetUsd ?? EFFORT_TABLE[DEFAULT_COMPOSITION.effort].budgetUsd,
    budgetTokens: partial.budgetTokens ?? EFFORT_TABLE[DEFAULT_COMPOSITION.effort].budgetTokens,
    maxTurnsPerPhase: partial.maxTurnsPerPhase ?? EFFORT_TABLE[DEFAULT_COMPOSITION.effort].maxTurnsPerPhase,
    maxFixRounds: partial.maxFixRounds ?? EFFORT_TABLE[DEFAULT_COMPOSITION.effort].maxFixRounds,
    publish: { ...DEFAULT_PUBLISH, ...((partial.publish as Partial<PublishPolicy> | undefined) ?? {}) },
    createdAt: partial.createdAt ?? new Date().toISOString(),
    ...(typeof partial.preset === "string" && partial.preset.trim() ? { preset: partial.preset.trim().slice(0, 80) } : {}),
    ...(Array.isArray(partial.guidance) && cleanGuidance(partial.guidance).lines.length ? { guidance: cleanGuidance(partial.guidance).lines } : {}),
    ...(Array.isArray(partial.presets) && partial.presets.length ? { presets: partial.presets.filter((x): x is string => typeof x === "string").slice(0, 12) } : {}),
    ...(partial.stageLessons && typeof partial.stageLessons === "object" ? { stageLessons: partial.stageLessons } : {}),
    ...(isEffort(partial.effort) ? { effort: partial.effort } : {}),
    ...(isSupervision(partial.supervision) ? { supervision: partial.supervision } : {}),
    ...(Array.isArray(partial.domains) ? { domains: partial.domains.filter((x): x is string => typeof x === "string").slice(0, 12) } : {}),
    ...(Array.isArray(partial.ablated) && partial.ablated.length ? { ablated: partial.ablated.filter((x) => tierOf(x) === "always") } : {}),
  };
}

// ---- Reliability math -----------------------------------------------------

export function trialKey(task: string, workspace: string): string {
  return `${workspace}\n${task.trim().replace(/\s+/g, " ")}`;
}

/** pass^k: all k pass; pass@k: at least one of k passes; both from the observed rate p. */
export function trialRates(passes: number, n: number, k: number): { passRate: number; passPowK: number; passAtK: number } {
  if (n === 0) return { passRate: 0, passPowK: 0, passAtK: 0 };
  const p = passes / n;
  return { passRate: p, passPowK: Math.pow(p, k), passAtK: 1 - Math.pow(1 - p, k) };
}

export function groupTrials(runs: RunSummary[], trialsByRun: Map<string, Trial>, k = 3): TrialSet[] {
  const sets = new Map<string, TrialSet & { task: string; workspace: string }>();
  for (const r of runs) {
    if (r.engine === "replay") continue;
    const t = trialsByRun.get(r.id);
    if (!t) continue;
    const ws = t.originWorkspace ?? r.workspace;
    const key = trialKey(t.title, ws);
    const set = sets.get(key) ?? { key, task: t.title, workspace: ws, trials: [], n: 0, passes: 0, infra: 0, passRate: 0, passPowK: 0, passAtK: 0, k };
    set.trials.push(t);
    sets.set(key, set);
  }
  const out: TrialSet[] = [];
  for (const set of sets.values()) {
    // Infrastructure failures say nothing about the agent: reported separately, never in the rate.
    set.infra = set.trials.filter((t) => t.failureKind === "infra").length;
    const finished = set.trials.filter((t) => (t.status === "completed" || t.status === "failed") && t.failureKind !== "infra");
    set.n = finished.length;
    set.passes = finished.filter((t) => t.verdict === "pass" && t.status === "completed").length;
    Object.assign(set, trialRates(set.passes, set.n, k));
    set.trials.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    out.push(set);
  }
  return out.sort((a, b) => (a.trials[0].createdAt < b.trials[0].createdAt ? 1 : -1));
}

// ---- Run guidance -----------------------------------------------------------

export const GUIDANCE_MAX_LINES = 10;
export const GUIDANCE_MAX_CHARS = 200;

/**
 * Normalise run guidance: strings only (others are dropped and reported by
 * index), newlines collapsed to spaces, each line capped at GUIDANCE_MAX_CHARS,
 * blank and duplicate lines removed, at most GUIDANCE_MAX_LINES lines.
 */
export function cleanGuidance(raw: unknown[]): { lines: string[]; dropped: string[] } {
  const lines: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  raw.forEach((v, i) => {
    if (typeof v !== "string") return void dropped.push(`guidance[${i}]`);
    const line = v.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GUIDANCE_MAX_CHARS).trim();
    const key = line.toLowerCase();
    if (!line || seen.has(key)) return;
    seen.add(key);
    if (lines.length >= GUIDANCE_MAX_LINES) return void dropped.push(`guidance[${i}]`);
    lines.push(line);
  });
  return { lines, dropped };
}
