// Shared contract between server and web. Everything the UI shows is derived
// from the append-only event log of a run (event sourcing), so replaying a
// recorded log reproduces the whole experience.

export type RoleId = "planner" | "builder" | "evaluator" | "classifier";

export type Phase = "plan" | "contract" | "build" | "evaluate" | "wrapup";

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ComponentId =
  | "planner"
  | "contracts"
  | "evaluator"
  | "progressFile"
  | "featureList"
  | "thinkTool"
  | "toolSearch"
  | "compaction"
  | "contextEditing"
  | "resetWithHandoff"
  | "actionClassifier"
  | "gitCommits"
  | "selfVerification"
  | "narration";

export interface HarnessComponent {
  id: ComponentId;
  label: string;
  short: string;
  /** The assumption about the model this component encodes. Stress-test it per model. */
  assumption: string;
  /** Lesson slugs (files in /lessons) that justify it. */
  lessons: string[];
  defaultOn: boolean;
  group: "roles" | "memory" | "context" | "tools" | "safety";
}

export type GuardrailMode = "ask" | "auto" | "trust";

export interface RunPauses {
  afterPlan: boolean;
  afterContract: boolean;
  beforeCommit: boolean;
  afterEvaluation: boolean;
}

export interface ContextPolicy {
  /** Trigger server-side compaction once prompt tokens exceed this. */
  compactAtTokens: number;
  /** Clear tool results older than this many turns (context editing). */
  clearToolResultsAfterTurns: number;
  /** Hand off to a fresh conversation once prompt tokens exceed this. */
  resetAtTokens: number;
}

export interface GuardrailPolicy {
  mode: GuardrailMode;
  allowNetwork: boolean;
  /** Extra shell patterns (regex source) that always need approval. */
  askPatterns: string[];
  /** Extra shell patterns (regex source) that are always denied. */
  denyPatterns: string[];
}

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface RoleSettings {
  model: string;
  effort: EffortLevel;
}

export interface RunConfig {
  id: string;
  title: string;
  task: string;
  workspace: string;
  engine: "anthropic" | "replay";
  roles: Record<Exclude<RoleId, "classifier">, RoleSettings> & { classifier: RoleSettings };
  components: Record<ComponentId, boolean>;
  pauses: RunPauses;
  context: ContextPolicy;
  guardrail: GuardrailPolicy;
  budgetUsd: number;
  maxTurnsPerPhase: number;
  maxFixRounds: number;
  createdAt: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ContractCriterion {
  id: string;
  text: string;
  /** How the evaluator will check it (a command, a file to inspect, a behaviour). */
  verify: string;
  /** Hard threshold: failing this fails the sprint. */
  hard: boolean;
}

export interface CriterionResult {
  id: string;
  pass: boolean;
  evidence: string;
}

export interface FeatureItem {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  note?: string;
}

export interface ContextSnapshot {
  role: RoleId;
  /** Real prompt size from usage (input + cache read + cache write). */
  promptTokens: number;
  limit: number;
  /** Estimated composition of the prompt. Sums to promptTokens. */
  composition: {
    system: number;
    tools: number;
    history: number;
    toolResults: number;
    thinking: number;
  };
  turn: number;
}

export type GuardrailVerdict = "allow" | "ask" | "deny";

export interface GuardrailDecision {
  toolUseId: string;
  tool: string;
  verdict: GuardrailVerdict;
  /** Which rule or classifier decided. */
  source: "rule" | "classifier" | "policy" | "user";
  rule: string;
  rationale: string;
}

export type ApprovalKind = "contract" | "action" | "phase";

export interface ApprovalRequest {
  approvalId: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  /** For actions: the tool call. For contracts: the criteria. For phases: the phase. */
  payload: unknown;
}

// ---- Events -------------------------------------------------------------

interface Base {
  seq: number;
  ts: string;
  runId: string;
}

export type RunEvent = Base &
  (
    | { type: "run.created"; config: RunConfig }
    | { type: "run.status"; status: RunStatus; reason?: string }
    | { type: "run.summary"; summary: string; costUsd: number; durationMs: number }
    | { type: "phase.started"; phase: Phase; round: number }
    | {
        type: "phase.finished";
        phase: Phase;
        round: number;
        summary: string;
        usage: Usage;
        costUsd: number;
        durationMs: number;
      }
    | { type: "turn.started"; role: RoleId; turn: number }
    | {
        type: "turn.finished";
        role: RoleId;
        turn: number;
        usage: Usage;
        costUsd: number;
        stopReason: string;
        model: string;
        fallbackModel?: string;
      }
    | { type: "text"; role: RoleId; text: string }
    | { type: "thinking"; role: RoleId; text: string }
    | {
        type: "tool.called";
        role: RoleId;
        toolUseId: string;
        name: string;
        input: unknown;
        /** Plain-language one-liner for the stage view. */
        narration: string;
      }
    | {
        type: "tool.result";
        role: RoleId;
        toolUseId: string;
        name: string;
        ok: boolean;
        output: string;
        truncated: boolean;
        durationMs: number;
      }
    | { type: "tools.loaded"; role: RoleId; names: string[] }
    | ({ type: "guardrail.decision"; role: RoleId } & GuardrailDecision)
    | { type: "approval.requested"; request: ApprovalRequest }
    | { type: "approval.resolved"; approvalId: string; decision: "approve" | "reject"; note?: string }
    | { type: "contract.proposed"; by: RoleId; criteria: ContractCriterion[]; rationale: string }
    | { type: "contract.agreed"; criteria: ContractCriterion[] }
    | {
        type: "evaluation.result";
        round: number;
        results: CriterionResult[];
        verdict: "pass" | "fail";
        summary: string;
      }
    | { type: "progress.updated"; features: FeatureItem[]; note: string }
    | { type: "context.snapshot"; snapshot: ContextSnapshot }
    | { type: "context.compacted"; role: RoleId; beforeTokens: number; afterTokens: number; summary: string }
    | { type: "context.cleared"; role: RoleId; clearedToolResults: number; tokensFreed: number }
    | { type: "context.reset"; role: RoleId; handoff: string; beforeTokens: number }
    | { type: "steer.received"; text: string; deliveredTo: RoleId | "next" }
    | { type: "steer.delivered"; text: string; role: RoleId }
    | { type: "git.commit"; sha: string; message: string; files: number }
    | { type: "files.changed"; files: ChangedFile[] }
    | { type: "error"; message: string; recoverable: boolean; detail?: string }
    | { type: "note"; level: "info" | "warn"; text: string }
  );

export type RunEventType = RunEvent["type"];

export interface ChangedFile {
  path: string;
  kind: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface RunSummary {
  id: string;
  title: string;
  status: RunStatus;
  phase?: Phase;
  round: number;
  costUsd: number;
  workspace: string;
  engine: RunConfig["engine"];
  model: string;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
}

export interface Lesson {
  slug: string;
  title: string;
  date: string;
  url: string;
  /** One-paragraph takeaway for cards. */
  takeaway: string;
  /** Dense bullets. */
  learnings: string[];
  /** Harness implications. */
  implications: string[];
  /** Components this lesson informs. */
  components: ComponentId[];
  tags: string[];
}

export interface ServerInfo {
  version: string;
  hasApiKey: boolean;
  home: string;
  defaultWorkspace: string;
  models: { id: string; label: string; inputPerM: number; outputPerM: number }[];
}

// ---- WS protocol --------------------------------------------------------

export type ClientMessage =
  | { type: "subscribe"; runId: string; fromSeq?: number }
  | { type: "unsubscribe"; runId: string };

export type ServerMessage =
  | { type: "event"; event: RunEvent }
  | { type: "runs"; runs: RunSummary[] }
  | { type: "hello"; info: ServerInfo };
