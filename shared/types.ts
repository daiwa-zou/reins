// Shared contract between server and web. Everything the UI shows is derived
// from the append-only event log of a run (event sourcing), so replaying a
// recorded log reproduces the whole experience.

export type RoleId = "planner" | "builder" | "evaluator" | "classifier" | "scout" | "librarian";

/** Roles every run config carries settings for. The librarian (lesson intake) borrows the planner's settings unless set. */
export type RunRoleId = Exclude<RoleId, "librarian">;

export type Phase = "plan" | "breakdown" | "contract" | "tests" | "build" | "evaluate" | "publish" | "wrapup";

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
  | "workPackages"
  | "contracts"
  | "testsFirst"
  | "publish"
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
  | "narration"
  | "scouts"
  | "skills"
  | "projectMemory"
  | "taskBudget"
  | "toolExamples"
  | "osSandbox"
  | "stageLessons";

/** The live engines. "replay" only re-plays a recorded log, so no component applies to it. */
export type EngineId = "anthropic" | "claude-code";

/** A dependency between components: without `id` on, this component does nothing or much less. */
export interface ComponentRequirement {
  id: ComponentId;
  /** Why, in one sentence, from the observed engine code. */
  reason: string;
}

export interface HarnessComponent {
  id: ComponentId;
  label: string;
  short: string;
  /** What the harness does instead when this component is off (one sentence). */
  whenOff: string;
  /** Which live engines actually honour this switch. On the others it is ignored. */
  engines: EngineId[];
  /** Components this one depends on. */
  requires?: ComponentRequirement[];
  /** The assumption about the model this component encodes. Stress-test it per model. */
  assumption: string;
  /** Lesson slugs (files in /lessons) that justify it. */
  lessons: string[];
  defaultOn: boolean;
  group: "roles" | "memory" | "context" | "tools" | "safety";
  /** Who decides whether it is on: "always" (nobody; only an ablation experiment turns it off), "effort" (the Effort dial), "engine" (derived from Supervision and the engine). */
  tier: ComponentTier;
}

export type ComponentTier = "always" | "effort" | "engine";
/** The Effort dial: what the harness spends on a task (shared/components.ts EFFORT_TABLE). Not the roles' reasoning effort. */
export type HarnessEffort = "low" | "medium" | "high" | "max";
/** How much the person wants to be asked (shared/components.ts SUPERVISION_TABLE). */
export type Supervision = "unattended" | "ask-to-publish" | "check-in" | "ask-every-write";
/** A run composition: one effort, one supervision, any number of domains in the order picked. */
export interface Composition {
  effort: HarnessEffort;
  supervision: Supervision;
  domains: string[];
}

export type GuardrailMode = "ask" | "auto" | "trust";

export interface RunPauses {
  afterPlan: boolean;
  afterContract: boolean;
  beforeCommit: boolean;
  afterEvaluation: boolean;
  /** Before the harness pushes a package's branch and opens its pull request. Absent on runs that predate publishing. */
  beforePublish?: boolean;
  /** Before the harness merges a package's pull request. Absent on runs that predate publishing. */
  beforeMerge?: boolean;
}

/** How the publish stage opens and merges a package's pull request. */
export interface PublishPolicy {
  /** The git remote to push to. */
  remote: string;
  /** The branch pull requests target; the branch checked out at run start when absent. */
  base?: string;
  /** Merge when an approving review is in and checks are green; when checks are green; or never (open the PR and stack the next package). */
  mergeWhen: "approved" | "checks" | "never";
  mergeMethod: "squash" | "merge" | "rebase";
  /** Seconds between looks at the pull request. */
  pollSeconds: number;
  /** Give up waiting for a merge after this long; the run fails naming the PR. */
  maxWaitMinutes: number;
  /** Review-feedback fix rounds per pull request. */
  maxReviewRounds: number;
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
  /** Narrow shell patterns (regex source) that are allowed without asking, e.g. ^npm run lint. Blanket interpreters are ignored. */
  allowPatterns?: string[];
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
  engine: "anthropic" | "claude-code" | "replay";
  roles: Record<RunRoleId, RoleSettings> & { librarian?: RoleSettings };
  components: Record<ComponentId, boolean>;
  pauses: RunPauses;
  context: ContextPolicy;
  guardrail: GuardrailPolicy;
  /** The dollar cap on the direct API engine (list price). Not applied on Claude Code, where usage counts against the subscription. */
  budgetUsd: number;
  /** The token cap on the Claude Code engine (input + output + cache writes, cache reads at a tenth). Absent on runs that predate it (the effort table's value applies). */
  budgetTokens?: number;
  maxTurnsPerPhase: number;
  maxFixRounds: number;
  /** The publish stage's policy. Absent on runs that predate it (defaults apply). */
  publish?: PublishPolicy;
  createdAt: string;
  /** Set on a trial that runs in a fresh git worktree cut from another workspace, so trial sets still group by the original. */
  origin?: { workspace: string; fresh: true };
  /** Name of the preset the run was started from, recorded for traceability. Absent on older runs. */
  preset?: string;
  /** Extra one-line instructions appended to every role's system prompt ("Guidance for this run"). */
  guidance?: string[];
  /** "intake" for a lesson intake job (never listed with runs); absent for a normal run. */
  job?: "intake";
  /** Legacy (runs before Effort and Supervision): the care profile and domain presets, e.g. ["careful","golang","cli"]. New runs record effort, supervision and domains instead. */
  presets?: string[];
  /** The Effort dial the run was composed with. Absent on runs that predate it (derived on read). */
  effort?: HarnessEffort;
  /** The Supervision level the run was composed with. Absent on runs that predate it (derived on read). */
  supervision?: Supervision;
  /** Domain presets layered over the composition, in the order picked. */
  domains?: string[];
  /** Always-tier components switched off as an experiment (the only way to turn one off). */
  ablated?: ComponentId[];
  /** "Lessons for this stage" lines per phase, resolved when the run was created (stage implications; see shared/implications.ts). */
  stageLessons?: Partial<Record<Phase, string[]>>;
}

/** A finding from checkRunConfig. Warnings never block a run. */
export interface ConfigWarning {
  level: "warn" | "info";
  /** The component the warning is about, if any. */
  component?: ComponentId;
  /** The setting the warning is about (e.g. "pauses.afterEvaluation"), if any. */
  setting?: string;
  message: string;
}

/** The parts of a run config a preset may set. Never task, workspace, id or createdAt. */
export type PresetConfig = Partial<Omit<RunConfig, "id" | "task" | "workspace" | "createdAt" | "title" | "preset" | "presets" | "stageLessons" | "ablated" | "components" | "roles" | "pauses" | "context" | "guardrail" | "publish">> & {
  components?: Partial<Record<ComponentId, boolean>>;
  publish?: Partial<PublishPolicy>;
  roles?: Partial<Record<RoleId, Partial<RoleSettings>>>;
  pauses?: Partial<RunPauses>;
  context?: Partial<ContextPolicy>;
  guardrail?: Partial<GuardrailPolicy>;
};

export interface Preset {
  name: string;
  /** Stable id for composition: "full", "minimal", "careful" for care profiles, the domain id for domain presets. */
  id?: string;
  /** "profile" (exactly one per run) or "domain" (any number, layered in order). */
  layer?: "profile" | "domain";
  /** Short chip label, e.g. "Go" or "CLI". */
  short?: string;
  description: string;
  builtIn: boolean;
  config: PresetConfig;
  /** On an engine that ignores some switches it turns on, the preset switches those off instead of being unavailable. */
  adaptive?: boolean;
  /** Composed from lessons (shared/presets.ts), not stored anywhere. */
  generated?: boolean;
  /** The lesson domain it was composed for, e.g. "web". */
  domain?: string;
  /** The lessons it was built from, with what each contributed. */
  basis?: PresetBasis[];
  /** A domain the user built from implications (domains.json), not one lessons name. */
  user?: boolean;
  /** Lesson slugs a user preset was built from (kept for traceability). */
  lessons?: string[];
}

/** A domain a person built from implications in the library (shared/domains.ts), stored in $REINS_HOME/domains.json. */
export interface UserDomain {
  /** The domain id used in a run's `domains`; a slug. */
  id: string;
  /** The chip text. */
  label: string;
  description: string;
  /** Implication ids (<lesson-slug>#<n>); only bundled or reviewed ones take effect. */
  implications: string[];
  createdAt?: string;
}

/** One lesson's contribution to a generated preset. */
export interface PresetBasis {
  slug: string;
  title: string;
  /** e.g. "on: Evaluator; guidance", or "overridden by <slug>" for a lost conflict. */
  effect: string;
}

/** Whether a preset fits an engine (presetCompatibility in shared/presets.ts). */
export interface PresetCompatibility {
  ok: boolean;
  /** ok only because the preset adapts: the components in `dropped` are switched off on this engine. */
  adaptive: boolean;
  reasons: string[];
  dropped: ComponentId[];
}

/** One finding about a lesson file. Errors make lessons:check fail; warnings do not. */
export interface LessonProblem {
  /** File name (e.g. broken.md) or "catalogue" for slugs in shared/components.ts. */
  file: string;
  source: "bundled" | "user" | "catalogue";
  level: "error" | "warn";
  message: string;
}

/** A skill as listed by GET /api/skills (the body is not sent). */
export interface SkillInfo {
  name: string;
  description: string;
  source: "bundled" | "user" | "workspace";
  dir: string;
  /** Lesson slugs linked to this skill (its `lessons:` frontmatter and [skill:<name>] implications). */
  lessons?: string[];
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
  /** The evaluator ran out of turns before checking this criterion: not verified, as opposed to observed to fail. */
  unverified?: boolean;
}

export type EvaluationOrigin = "reported" | "forced" | "synthesised";

/** A pull-request-sized slice of the feature list, cut by the breakdown stage (shared/packages.ts). */
export interface WorkPackage {
  id: string;
  title: string;
  /** Feature ids built by this package; every feature belongs to exactly one package. */
  features: string[];
  /** Why these features make one reviewable change. */
  rationale: string;
  /** The planner's estimate of changed lines; 0 when unknown (the implicit single package). */
  estimatedLines: number;
  /** Packages that must land before this one, all earlier in the list. */
  dependsOn: string[];
}

/** One test the tests stage wrote before the build, and what it proves. */
export interface TestSpec {
  id: string;
  /** Workspace-relative file that holds it. */
  file: string;
  name: string;
  /** Contract criterion ids it covers. */
  criteria: string[];
  kind: "unit" | "behavior" | "integration" | "e2e";
  /** What it checks and why, for the reviewer. */
  explains: string;
}

/** The tests stage's output (shared/testPlan.ts): the suite the builder must make pass. */
export interface TestPlan {
  /** Runs the new tests; it is also the verification step of the T criterion. */
  command: string;
  tests: TestSpec[];
  /** Hard criteria no test can check here, each with the reason. */
  uncovered: { id: string; reason: string }[];
  /** The writer's overall explanation. */
  explanation: string;
}

/** Which package a contract, build or evaluate phase belongs to. */
export interface PackageRef {
  id: string;
  title: string;
  /** 1-based position and the number of packages. */
  index: number;
  total: number;
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

export type ApprovalKind = "contract" | "action" | "phase" | "lesson" | "publish";

/** "revise" is only meaningful for a publish approval: the builder redrafts the pull request from the note and the card comes back. */
export type ApprovalDecision = "approve" | "reject" | "revise";

/** The pull request a publish approval shows: editable before the branch is pushed. */
export interface PublishDraft {
  title: string;
  body: string;
}

export interface ApprovalRequest {
  approvalId: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  /** For actions: the tool call. For contracts: the criteria. For phases: the phase. For publish: the draft (PublishDraft plus branch, base, package, revision). */
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
    | { type: "phase.started"; phase: Phase; round: number; package?: PackageRef }
    | {
        type: "phase.finished";
        phase: Phase;
        round: number;
        package?: PackageRef;
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
    | { type: "approval.resolved"; approvalId: string; decision: ApprovalDecision; note?: string }
    | { type: "contract.proposed"; by: RoleId; criteria: ContractCriterion[]; rationale: string }
    | { type: "contract.agreed"; criteria: ContractCriterion[] }
    /** A role ran a criterion's verification step itself and recorded what it saw (the builder's self-check; the evaluator's verdict is evaluation.result). */
    | { type: "criterion.checked"; role: RoleId; id: string; pass: boolean; evidence: string }
    | { type: "breakdown.agreed"; packages: WorkPackage[]; rationale: string }
    | { type: "tests.agreed"; plan: TestPlan; red: { exitCode: number | null; excerpt: string } }
    | { type: "pr.opened"; number: number; url: string; branch: string; base: string; package?: PackageRef }
    | { type: "pr.merged"; number: number; url: string; branch: string; base: string; sha: string }
    | { type: "pr.feedback"; number: number; url: string; round: number; comments: number; checks: string[]; summary: string }
    | {
        type: "evaluation.result";
        round: number;
        results: CriterionResult[];
        verdict: "pass" | "fail";
        summary: string;
        /**
         * How the report came about: reported by the evaluator on its own (absent or "reported"),
         * "forced" by the final turn-budget call that offers only report_evaluation, or
         * "synthesised" by the harness when even that call did not report (every criterion unverified).
         */
        origin?: EvaluationOrigin;
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
  /** The run title chip ("High · Check in · Go · CLI", or "Careful · Go · CLI" for older runs). */
  chip?: string;
  status: RunStatus;
  phase?: Phase;
  round: number;
  /** The work package the latest phase belongs to, when it is a per-package phase. */
  package?: PackageRef;
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
  /** Architectural foundations (not switchable) this lesson informs. */
  foundations: string[];
  tags: string[];
  /** Preset domains this lesson shapes (e.g. web, cli): frontmatter `domains:`. */
  domains?: string[];
  /** Components a preset for those domains turns on / off: frontmatter `enables:` / `disables:`. */
  enables?: ComponentId[];
  disables?: ComponentId[];
  /** One line of run guidance the preset adds: frontmatter `guidance:`. */
  guidance?: string;
  /** Bundled with Reins (lessons/) or from the user's library ($REINS_HOME/lessons). */
  source: "bundled" | "user";
  /** Typed harness implications (one per "## Harness implications" bullet, plus frontmatter components:/foundations:). */
  items: Implication[];
  /** What kind of source the lesson distils: frontmatter `source:`. */
  provenance?: LessonProvenance;
  /** Bundled lessons are always "bundled"; user lessons default to "unreviewed". Frontmatter `standing:`. */
  standing: Standing;
  /** sha256 of the source text an intake job distilled this lesson from (frontmatter `hash:`). */
  hash?: string;
  /** What the intake job was told to look for in its source (frontmatter `focus:`); the same source with another focus is another lesson. */
  focus?: string;
}

export type ImplicationKind = "component" | "stage" | "skill" | "foundation" | "gap" | "effort";
export type Standing = "bundled" | "reviewed" | "unreviewed";
export type LessonProvenance = "post" | "article" | "paper" | "postmortem" | "note" | "repo" | "mcp";

/** An MCP server an intake job may read from: a command to spawn (stdio) or an HTTP endpoint. */
export interface McpServerSpec {
  /** Short name; the server's tools appear as mcp__<name>__<tool>. */
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** Where an intake job reads from. */
export type IntakeSourceSpec =
  | { kind: "url"; url: string }
  | { kind: "text" }
  /** A git URL (cloned shallowly) or a local directory (read in place); `ref` is a branch or tag for a clone. */
  | { kind: "repo"; repo: string; ref?: string }
  | { kind: "mcp"; server: McpServerSpec };

/** One claim a lesson makes about the harness: the atomic link between lessons, components, stages and skills. */
export interface Implication {
  /** `${slug}#${n}`, stable while the bullet order is. */
  id: string;
  lesson: string;
  /** The lesson's date, for "newest first". */
  date: string;
  kind: ImplicationKind;
  /** Component id, phase name, skill name or foundation id. Absent for kind gap. */
  target?: string;
  /** One sentence. */
  claim: string;
  /** Evidence: a verbatim quote from the source (empty when the lesson gives none). */
  quote: string;
  /** Domain tags: the bullet's `domains:` line plus the lesson-level `domains:`. */
  domains: string[];
  standing: Standing;
  /** Derived from a frontmatter components:/foundations: entry rather than a bullet. */
  implicit?: boolean;
}

/** A fixed architectural decision of the harness, with the lessons behind it. */
export interface Foundation {
  id: string;
  label: string;
  short: string;
  lessons: string[];
}

// ---- Reliability lab ----------------------------------------------------

export interface Trial {
  runId: string;
  title: string;
  status: RunStatus;
  verdict: "pass" | "fail" | "none";
  costUsd: number;
  durationMs: number;
  fixRounds: number;
  createdAt: string;
  engine: RunConfig["engine"];
  model: string;
  harnessVersion?: string;
  /** What ended a non-passing trial: the agent's work, or the infrastructure (API, server restart, timeouts). */
  failureKind: "none" | "agent" | "infra";
  /** The workspace the trial set is keyed by (the original one for fresh-worktree trials). */
  originWorkspace?: string;
  fresh?: boolean;
}

export interface TrialSet {
  key: string;
  task: string;
  workspace: string;
  trials: Trial[];
  /** Finished trials only, infra failures excluded. */
  n: number;
  passes: number;
  /** Trials that ended on infrastructure (not counted in n). */
  infra: number;
  /** Observed pass rate over finished trials. */
  passRate: number;
  /** Probability that ALL of k trials pass (consistency), from the observed rate. */
  passPowK: number;
  /** Probability that at least one of k trials passes. */
  passAtK: number;
  k: number;
}

export interface ServerInfo {
  version: string;
  hasApiKey: boolean;
  /** Whether the local Claude Code login can drive the claude-code engine. */
  hasClaudeCode: boolean;
  sandboxAvailable: boolean;
  home: string;
  defaultWorkspace: string;
  models: { id: string; label: string; inputPerM: number; outputPerM: number }[];
}

// ---- WS protocol --------------------------------------------------------

export type ClientMessage =
  | { type: "subscribe"; runId: string; fromSeq?: number }
  | { type: "unsubscribe"; runId: string };

/** A lesson intake job as the web app lists it (GET /api/intake, and the "intake" server message). */
export interface IntakeJobSummary {
  id: string;
  slug: string;
  url?: string;
  /** Absent for jobs recorded before sources other than a URL or pasted text existed. */
  source?: IntakeSourceSpec;
  /** What the librarian was told to look for. */
  focus?: string;
  status: "running" | "waiting_approval" | "adopted" | "rejected" | "failed" | "refused" | "cancelled" | "interrupted";
  createdAt: string;
  updatedAt?: string;
  lessonSlug?: string;
  reason?: string;
  /** Live in this server process: it can be approved or cancelled. */
  active: boolean;
}

export type ServerMessage =
  /** One live event. */
  | { type: "event"; event: RunEvent }
  /** The stored events of a run from the subscriber's `fromSeq`, in one frame, so a reconnect or a first open does not replay them one by one. */
  | { type: "events"; runId: string; events: RunEvent[] }
  | { type: "intake"; jobs: IntakeJobSummary[] }
  | { type: "runs"; runs: RunSummary[] }
  | { type: "hello"; info: ServerInfo };
