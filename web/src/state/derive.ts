import type {
  ApprovalDecision,
  ApprovalRequest,
  ChangedFile,
  ContextSnapshot,
  ContractCriterion,
  CriterionResult,
  EvaluationOrigin,
  FeatureItem,
  GuardrailDecision,
  PackageRef,
  Phase,
  TestPlan,
  RoleId,
  RunConfig,
  RunEvent,
  RunStatus,
  Usage,
} from "@shared/types";

export interface ToolCall {
  seq: number;
  ts: string;
  role: RoleId;
  toolUseId: string;
  name: string;
  input: unknown;
  narration: string;
  result?: { ok: boolean; output: string; truncated: boolean; durationMs: number };
  guardrail?: GuardrailDecision;
}

export type FeedItem =
  | { kind: "phase"; seq: number; ts: string; phase: Phase; round: number; package?: PackageRef; finished?: { summary: string; costUsd: number; durationMs: number } }
  | { kind: "turn"; seq: number; ts: string; role: RoleId; turn: number; thinking?: string; text?: string; calls: ToolCall[]; usage?: Usage; costUsd?: number; stopReason?: string; finishedTs?: string }
  | { kind: "approval"; seq: number; ts: string; request: ApprovalRequest; resolved?: { decision: ApprovalDecision; note?: string } }
  | { kind: "contract"; seq: number; ts: string; by: RoleId | "agreed"; criteria: ContractCriterion[]; rationale?: string }
  | { kind: "tests"; seq: number; ts: string; plan: TestPlan; red: { exitCode: number | null; excerpt: string } }
  | { kind: "pr"; seq: number; ts: string; what: "opened" | "merged" | "feedback"; number: number; url: string; branch?: string; base?: string; package?: PackageRef; sha?: string; round?: number; comments?: number; checks?: string[]; summary?: string }
  | { kind: "evaluation"; seq: number; ts: string; round: number; package?: PackageRef; verdict: "pass" | "fail"; results: CriterionResult[]; summary: string; origin?: EvaluationOrigin }
  | { kind: "context"; seq: number; ts: string; what: "compacted" | "cleared" | "reset"; role: RoleId; detail: string }
  | { kind: "steer"; seq: number; ts: string; text: string; delivered: boolean }
  | { kind: "commit"; seq: number; ts: string; sha: string; message: string; files: number }
  | { kind: "note"; seq: number; ts: string; level: "info" | "warn" | "error"; text: string }
  | ({ kind: "check" } & CriterionCheck);

/** A role's own check of one criterion (the builder's self-verification), as opposed to the evaluator's verdict. */
export interface CriterionCheck {
  seq: number;
  ts: string;
  role: RoleId;
  id: string;
  pass: boolean;
  evidence: string;
}

/** One evaluation round. Rounds restart at 1 for every work package, so `package` tells them apart. */
export interface EvaluationRound {
  /** The event's position in the log, to order it against the builder's later checks. */
  seq: number;
  round: number;
  package?: PackageRef;
  verdict: "pass" | "fail";
  results: CriterionResult[];
  summary: string;
  origin?: EvaluationOrigin;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  branch: string;
  base: string;
  package?: PackageRef;
  openedTs: string;
  merged?: { sha: string; ts: string };
  /** Review rounds the harness ran on it. */
  rounds?: { round: number; comments: number; checks: string[]; summary: string; ts: string }[];
}

export interface PhaseStat {
  phase: Phase;
  round: number;
  /** The work package a contract, build or evaluate phase belongs to. */
  package?: PackageRef;
  startedTs: string;
  finishedTs?: string;
  summary?: string;
  costUsd: number;
  usage: Usage;
  turns: number;
}

export interface RunModel {
  config?: RunConfig;
  status: RunStatus;
  statusReason?: string;
  phases: PhaseStat[];
  currentPhase?: PhaseStat;
  feed: FeedItem[];
  calls: ToolCall[];
  /** The latest agreed contract, and the work package it was agreed for (absent for an implicit single package). */
  contract: ContractCriterion[];
  contractPackage?: PackageRef;
  /** The builder's latest self-check per criterion id of the current contract; cleared when a new contract is agreed. */
  checks: Record<string, CriterionCheck>;
  contractHistory: { by: RoleId; criteria: ContractCriterion[]; rationale: string }[];
  /** The latest tests-stage plan (per package) with its red run. */
  tests?: { plan: TestPlan; red: { exitCode: number | null; excerpt: string } };
  /** Pull requests the publish stage opened, in order, with their merges. */
  pullRequests: PullRequestInfo[];
  evaluations: EvaluationRound[];
  features: FeatureItem[];
  snapshots: (ContextSnapshot & { seq: number })[];
  latestSnapshot: Partial<Record<RoleId, ContextSnapshot>>;
  contextEvents: { seq: number; role: RoleId; what: "compacted" | "cleared" | "reset"; detail: string }[];
  guardrails: (GuardrailDecision & { seq: number; ts: string; role: RoleId })[];
  pending: ApprovalRequest[];
  costUsd: number;
  usage: Usage;
  files: ChangedFile[];
  commits: { sha: string; message: string; files: number; ts: string }[];
  steers: { text: string; delivered: boolean; ts: string }[];
  toolsLoaded: string[];
  errors: string[];
  summary?: { summary: string; costUsd: number; durationMs: number };
  lastSeq: number;
  startedTs?: string;
  lastTs?: string;
}

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Fold an event log (optionally truncated at a seq for scrubbing) into the view model.
 *
 * Turn tracking: every text, thinking and tool call event of a role attaches to that
 * role's open turn until its next turn.started or a phase boundary. Events that arrive
 * mid-turn (context edits, notes, steers, approvals) never close it: the engines emit
 * them between turn.finished and the turn's text and tool calls.
 */
export function derive(events: RunEvent[], upTo = Infinity): RunModel {
  const m: RunModel = {
    status: "queued",
    phases: [],
    feed: [],
    calls: [],
    contract: [],
    checks: {},
    contractHistory: [],
    pullRequests: [],
    evaluations: [],
    features: [],
    snapshots: [],
    latestSnapshot: {},
    contextEvents: [],
    guardrails: [],
    pending: [],
    costUsd: 0,
    usage: zeroUsage(),
    files: [],
    commits: [],
    steers: [],
    toolsLoaded: [],
    errors: [],
    lastSeq: -1,
  };
  const callsById = new Map<string, ToolCall>();
  const pending = new Map<string, ApprovalRequest>();
  let currentTurn: Extract<FeedItem, { kind: "turn" }> | null = null;
  let currentPhaseIdx = -1;
  const phasePackage = () => m.phases[currentPhaseIdx]?.package;
  const pkgField = () => {
    const p = phasePackage();
    return p ? { package: p } : {};
  };

  for (const ev of events) {
    if (ev.seq > upTo) break;
    m.lastSeq = ev.seq;
    m.lastTs = ev.ts;
    if (!m.startedTs) m.startedTs = ev.ts;
    switch (ev.type) {
      case "run.created":
        m.config = ev.config;
        break;
      case "run.status":
        m.status = ev.status;
        m.statusReason = ev.reason;
        break;
      case "phase.started": {
        m.phases.push({ phase: ev.phase, round: ev.round, ...(ev.package ? { package: ev.package } : {}), startedTs: ev.ts, costUsd: 0, usage: zeroUsage(), turns: 0 });
        currentPhaseIdx = m.phases.length - 1;
        m.feed.push({ kind: "phase", seq: ev.seq, ts: ev.ts, phase: ev.phase, round: ev.round, ...(ev.package ? { package: ev.package } : {}) });
        currentTurn = null;
        break;
      }
      case "phase.finished": {
        const p = m.phases[currentPhaseIdx];
        if (p) {
          p.finishedTs = ev.ts;
          p.summary = ev.summary;
          p.costUsd = ev.costUsd;
          p.usage = ev.usage;
        }
        const f = [...m.feed].reverse().find((x) => x.kind === "phase" && x.phase === ev.phase && x.round === ev.round) as Extract<FeedItem, { kind: "phase" }> | undefined;
        if (f) f.finished = { summary: ev.summary, costUsd: ev.costUsd, durationMs: ev.durationMs };
        currentTurn = null;
        break;
      }
      case "turn.started":
        // A retried model call starts the same turn again; the superseded item ends here instead of showing as working forever.
        if (currentTurn && currentTurn.role === ev.role && !currentTurn.finishedTs) currentTurn.finishedTs = ev.ts;
        currentTurn = { kind: "turn", seq: ev.seq, ts: ev.ts, role: ev.role, turn: ev.turn, calls: [] };
        m.feed.push(currentTurn);
        if (m.phases[currentPhaseIdx]) m.phases[currentPhaseIdx].turns++;
        break;
      case "turn.finished":
        if (currentTurn && currentTurn.role === ev.role) {
          // Engines may report usage and cost in separate events for one turn.
          if (ev.usage.input + ev.usage.output + ev.usage.cacheRead + ev.usage.cacheWrite > 0) currentTurn.usage = ev.usage;
          currentTurn.costUsd = (currentTurn.costUsd ?? 0) + ev.costUsd;
          if (ev.stopReason) currentTurn.stopReason = ev.stopReason;
          currentTurn.finishedTs = ev.ts;
        }
        m.costUsd += ev.costUsd;
        m.usage = { input: m.usage.input + ev.usage.input, output: m.usage.output + ev.usage.output, cacheRead: m.usage.cacheRead + ev.usage.cacheRead, cacheWrite: m.usage.cacheWrite + ev.usage.cacheWrite };
        break;
      case "text":
        if (currentTurn && currentTurn.role === ev.role) currentTurn.text = (currentTurn.text ? currentTurn.text + "\n\n" : "") + ev.text;
        else m.feed.push({ kind: "note", seq: ev.seq, ts: ev.ts, level: "info", text: ev.text });
        break;
      case "thinking":
        if (currentTurn && currentTurn.role === ev.role) currentTurn.thinking = (currentTurn.thinking ? currentTurn.thinking + "\n" : "") + ev.text;
        break;
      case "tool.called": {
        const call: ToolCall = { seq: ev.seq, ts: ev.ts, role: ev.role, toolUseId: ev.toolUseId, name: ev.name, input: ev.input, narration: ev.narration };
        callsById.set(ev.toolUseId, call);
        m.calls.push(call);
        if (currentTurn && currentTurn.role === ev.role) currentTurn.calls.push(call);
        else {
          currentTurn = { kind: "turn", seq: ev.seq, ts: ev.ts, role: ev.role, turn: 0, calls: [call] };
          m.feed.push(currentTurn);
        }
        break;
      }
      case "tool.result": {
        const call = callsById.get(ev.toolUseId);
        if (call) call.result = { ok: ev.ok, output: ev.output, truncated: ev.truncated, durationMs: ev.durationMs };
        break;
      }
      case "tools.loaded":
        for (const n of ev.names) if (!m.toolsLoaded.includes(n)) m.toolsLoaded.push(n);
        break;
      case "guardrail.decision": {
        const { type: _t, seq, ts, runId: _r, role, ...d } = ev as any;
        m.guardrails.push({ ...d, seq, ts, role });
        const call = callsById.get(ev.toolUseId);
        if (call) call.guardrail = d;
        break;
      }
      case "approval.requested":
        pending.set(ev.request.approvalId, ev.request);
        m.feed.push({ kind: "approval", seq: ev.seq, ts: ev.ts, request: ev.request });
        break;
      case "approval.resolved": {
        pending.delete(ev.approvalId);
        const f = m.feed.find((x) => x.kind === "approval" && x.request.approvalId === ev.approvalId) as Extract<FeedItem, { kind: "approval" }> | undefined;
        if (f) f.resolved = { decision: ev.decision, note: ev.note };
        break;
      }
      case "contract.proposed":
        m.contractHistory.push({ by: ev.by, criteria: ev.criteria, rationale: ev.rationale });
        m.feed.push({ kind: "contract", seq: ev.seq, ts: ev.ts, by: ev.by, criteria: ev.criteria, rationale: ev.rationale });
        break;
      case "contract.agreed":
        m.contract = ev.criteria;
        m.contractPackage = phasePackage();
        // A new contract starts unchecked; the tests stage re-agrees the same contract with its T criterion, so keep checks for ids that survive.
        m.checks = Object.fromEntries(Object.entries(m.checks).filter(([id]) => ev.criteria.some((c) => c.id === id)));
        m.feed.push({ kind: "contract", seq: ev.seq, ts: ev.ts, by: "agreed", criteria: ev.criteria });
        break;
      case "criterion.checked": {
        const check: CriterionCheck = { seq: ev.seq, ts: ev.ts, role: ev.role, id: ev.id, pass: ev.pass, evidence: ev.evidence };
        m.checks[ev.id] = check;
        m.feed.push({ kind: "check", ...check });
        break;
      }
      case "tests.agreed":
        m.tests = { plan: ev.plan, red: ev.red };
        m.feed.push({ kind: "tests", seq: ev.seq, ts: ev.ts, plan: ev.plan, red: ev.red });
        break;
      case "pr.opened":
        m.pullRequests.push({ number: ev.number, url: ev.url, branch: ev.branch, base: ev.base, ...(ev.package ? { package: ev.package } : {}), openedTs: ev.ts });
        m.feed.push({ kind: "pr", seq: ev.seq, ts: ev.ts, what: "opened", number: ev.number, url: ev.url, branch: ev.branch, base: ev.base, ...(ev.package ? { package: ev.package } : {}) });
        break;
      case "pr.feedback": {
        const pr = m.pullRequests.find((p) => p.number === ev.number);
        if (pr) pr.rounds = [...(pr.rounds ?? []), { round: ev.round, comments: ev.comments, checks: ev.checks, summary: ev.summary, ts: ev.ts }];
        m.feed.push({ kind: "pr", seq: ev.seq, ts: ev.ts, what: "feedback", number: ev.number, url: ev.url, round: ev.round, comments: ev.comments, checks: ev.checks, summary: ev.summary });
        break;
      }
      case "pr.merged": {
        const pr = m.pullRequests.find((p) => p.number === ev.number);
        if (pr) pr.merged = { sha: ev.sha, ts: ev.ts };
        m.feed.push({ kind: "pr", seq: ev.seq, ts: ev.ts, what: "merged", number: ev.number, url: ev.url, branch: ev.branch, base: ev.base, sha: ev.sha });
        break;
      }
      case "evaluation.result": {
        const round: EvaluationRound = { seq: ev.seq, round: ev.round, ...pkgField(), verdict: ev.verdict, results: ev.results, summary: ev.summary, origin: ev.origin };
        m.evaluations.push(round);
        m.feed.push({ kind: "evaluation", ts: ev.ts, ...round });
        break;
      }
      case "progress.updated":
        m.features = ev.features;
        break;
      case "context.snapshot":
        m.snapshots.push({ ...ev.snapshot, seq: ev.seq });
        m.latestSnapshot[ev.snapshot.role] = ev.snapshot;
        break;
      case "context.compacted":
        m.contextEvents.push({ seq: ev.seq, role: ev.role, what: "compacted", detail: `${Math.round(ev.beforeTokens / 1000)}k → ${Math.round(ev.afterTokens / 1000)}k tokens` });
        m.feed.push({ kind: "context", seq: ev.seq, ts: ev.ts, what: "compacted", role: ev.role, detail: ev.summary });
        break;
      case "context.cleared":
        m.contextEvents.push({ seq: ev.seq, role: ev.role, what: "cleared", detail: `${ev.clearedToolResults} tool results, ${Math.round(ev.tokensFreed / 1000)}k tokens freed` });
        m.feed.push({ kind: "context", seq: ev.seq, ts: ev.ts, what: "cleared", role: ev.role, detail: `Cleared ${ev.clearedToolResults} stale tool results (${Math.round(ev.tokensFreed / 1000)}k tokens freed).` });
        break;
      case "context.reset":
        m.contextEvents.push({ seq: ev.seq, role: ev.role, what: "reset", detail: `fresh conversation from handoff (${Math.round(ev.beforeTokens / 1000)}k tokens before)` });
        m.feed.push({ kind: "context", seq: ev.seq, ts: ev.ts, what: "reset", role: ev.role, detail: ev.handoff });
        break;
      case "steer.received":
        m.steers.push({ text: ev.text, delivered: false, ts: ev.ts });
        m.feed.push({ kind: "steer", seq: ev.seq, ts: ev.ts, text: ev.text, delivered: false });
        break;
      case "steer.delivered": {
        const s = m.steers.find((x) => x.text === ev.text && !x.delivered);
        if (s) s.delivered = true;
        const f = m.feed.find((x) => x.kind === "steer" && x.text === ev.text && !x.delivered) as Extract<FeedItem, { kind: "steer" }> | undefined;
        if (f) f.delivered = true;
        break;
      }
      case "git.commit":
        m.commits.push({ sha: ev.sha, message: ev.message, files: ev.files, ts: ev.ts });
        m.feed.push({ kind: "commit", seq: ev.seq, ts: ev.ts, sha: ev.sha, message: ev.message, files: ev.files });
        break;
      case "files.changed":
        m.files = ev.files;
        break;
      case "error":
        m.errors.push(ev.message);
        m.feed.push({ kind: "note", seq: ev.seq, ts: ev.ts, level: "error", text: ev.message });
        break;
      case "note":
        m.feed.push({ kind: "note", seq: ev.seq, ts: ev.ts, level: ev.level, text: ev.text });
        break;
      case "run.summary":
        // The end card renders it from `summary`; it is not a feed item of its own.
        m.summary = { summary: ev.summary, costUsd: ev.costUsd, durationMs: ev.durationMs };
        break;
    }
  }
  m.pending = [...pending.values()];
  m.currentPhase = m.phases.find((p) => !p.finishedTs) ?? m.phases[m.phases.length - 1];
  return m;
}

export const PHASE_ORDER: Phase[] = ["plan", "breakdown", "contract", "tests", "build", "evaluate", "publish", "wrapup"];
export const PHASE_LABEL: Record<Phase, string> = { plan: "Plan", breakdown: "Breakdown", contract: "Contract", tests: "Tests", build: "Build", evaluate: "Evaluate", publish: "Publish", wrapup: "Wrap up" };
export const ROLE_LABEL: Record<RoleId, string> = { planner: "Planner", builder: "Builder", evaluator: "Evaluator", classifier: "Classifier", scout: "Scout", librarian: "Librarian" };
export const isLive = (s: RunStatus) => s === "running" || s === "paused" || s === "waiting_approval" || s === "queued";
