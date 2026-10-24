import type { ComponentId, HarnessComponent, RunConfig } from "./types.js";

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
    assumption: "Given a 1-4 sentence task the builder under-scopes or skips features.",
    lessons: ["harness-design-long-running-apps", "effective-harnesses-for-long-running-agents"],
    defaultOn: true,
    group: "roles",
  },
  {
    id: "contracts",
    label: "Sprint contracts",
    short: "Builder and evaluator agree what 'done' means and how to verify it before any code is written.",
    assumption: "Without an agreed definition of done the builder declares victory early.",
    lessons: ["harness-design-long-running-apps"],
    defaultOn: true,
    group: "roles",
  },
  {
    id: "evaluator",
    label: "Skeptical evaluator",
    short: "A separate agent checks every contract criterion against the live result.",
    assumption: "Agents overrate their own output; a standalone evaluator is easier to make skeptical.",
    lessons: ["harness-design-long-running-apps", "demystifying-evals-for-ai-agents"],
    defaultOn: true,
    group: "roles",
  },
  {
    id: "featureList",
    label: "Feature list (features.json)",
    short: "A structured feature list the agent must not delete from, only mark done.",
    assumption: "Over long work the agent loses track of what remains and prematurely declares completion.",
    lessons: ["effective-harnesses-for-long-running-agents"],
    defaultOn: true,
    group: "memory",
  },
  {
    id: "progressFile",
    label: "Progress notes (progress.md)",
    short: "Structured note-taking outside the context window, re-read at the start of every session.",
    assumption: "The next session starts with zero memory of this one.",
    lessons: ["effective-harnesses-for-long-running-agents", "effective-context-engineering-for-ai-agents"],
    defaultOn: true,
    group: "memory",
  },
  {
    id: "gitCommits",
    label: "Commit per phase",
    short: "Leave the repo in a clean, committed state at each phase boundary.",
    assumption: "A half-finished uncommitted change confuses the next session.",
    lessons: ["effective-harnesses-for-long-running-agents", "claude-code-best-practices"],
    defaultOn: true,
    group: "memory",
  },
  {
    id: "compaction",
    label: "Compaction",
    short: "Summarize old history in place when the prompt grows past a threshold.",
    assumption: "The task outlives a single context window.",
    lessons: ["effective-context-engineering-for-ai-agents", "harness-design-long-running-apps"],
    defaultOn: true,
    group: "context",
  },
  {
    id: "contextEditing",
    label: "Clear stale tool results",
    short: "Drop old tool outputs from the prompt without summarizing them.",
    assumption: "Most tool output is only useful for a turn or two.",
    lessons: ["effective-context-engineering-for-ai-agents"],
    defaultOn: true,
    group: "context",
  },
  {
    id: "resetWithHandoff",
    label: "Reset with handoff",
    short: "Start a fresh conversation from a written handoff when the context is nearly full.",
    assumption: "The model gets 'context anxiety' and wraps up early as the window fills.",
    lessons: ["harness-design-long-running-apps", "multi-agent-research-system"],
    defaultOn: false,
    group: "context",
  },
  {
    id: "thinkTool",
    label: "Think tool",
    short: "A no-op tool that gives the model a place to stop and reason between tool calls.",
    assumption: "Long tool-call chains with policy constraints benefit from explicit pauses.",
    lessons: ["claude-think-tool"],
    defaultOn: true,
    group: "tools",
  },
  {
    id: "toolSearch",
    label: "Tool search",
    short: "Keep rarely-used tools out of the prompt and load them on demand.",
    assumption: "Every tool schema in context costs tokens and attention whether it is used or not.",
    lessons: ["advanced-tool-use", "writing-tools-for-agents"],
    defaultOn: true,
    group: "tools",
  },
  {
    id: "selfVerification",
    label: "Self-verification",
    short: "The builder must run the contract's verification steps before calling finish.",
    assumption: "Left alone the builder tests superficially.",
    lessons: ["effective-harnesses-for-long-running-agents", "claude-code-best-practices"],
    defaultOn: true,
    group: "tools",
  },
  {
    id: "actionClassifier",
    label: "Action classifier",
    short: "Classify each risky shell command against the task instead of asking about everything.",
    assumption: "Permission prompts train people to click yes; a classifier that knows the task can decide most cases.",
    lessons: ["claude-code-auto-mode", "claude-code-sandboxing"],
    defaultOn: true,
    group: "safety",
  },
  {
    id: "narration",
    label: "Plain-language narration",
    short: "Every tool call is rendered as a sentence a person can skim.",
    assumption: "Raw JSON transcripts are not read; unread transcripts hide failures.",
    lessons: ["demystifying-evals-for-ai-agents", "multi-agent-research-system"],
    defaultOn: true,
    group: "tools",
  },
];

export const COMPONENT_IDS = COMPONENTS.map((c) => c.id) as ComponentId[];

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

export const CONTEXT_LIMIT_TOKENS = 1_000_000;

export function defaultRunConfig(partial: Partial<RunConfig> & { task: string; workspace: string }): RunConfig {
  return {
    id: partial.id ?? "",
    title: partial.title ?? partial.task.slice(0, 60),
    task: partial.task,
    workspace: partial.workspace,
    engine: partial.engine ?? "anthropic",
    roles: partial.roles ?? {
      planner: { model: DEFAULT_MODEL, effort: "high" },
      builder: { model: DEFAULT_MODEL, effort: "high" },
      evaluator: { model: DEFAULT_MODEL, effort: "high" },
      classifier: { model: "claude-haiku-5-5", effort: "low" },
    },
    components: partial.components ?? defaultComponents(),
    pauses: partial.pauses ?? { afterPlan: false, afterContract: true, beforeCommit: false, afterEvaluation: false },
    context: partial.context ?? { compactAtTokens: 150_000, clearToolResultsAfterTurns: 8, resetAtTokens: 400_000 },
    guardrail: partial.guardrail ?? { mode: "auto", allowNetwork: false, askPatterns: [], denyPatterns: [] },
    budgetUsd: partial.budgetUsd ?? 10,
    maxTurnsPerPhase: partial.maxTurnsPerPhase ?? 60,
    maxFixRounds: partial.maxFixRounds ?? 2,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}
