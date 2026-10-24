import type {
  ApprovalRequest,
  ChangedFile,
  ContextSnapshot,
  ContractCriterion,
  CriterionResult,
  FeatureItem,
  GuardrailDecision,
  Phase,
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
  | { kind: "phase"; seq: number; ts: string; phase: Phase; round: number; finished?: { summary: string; costUsd: number; durationMs: number } }
  | { kind: "turn"; seq: number; ts: string; role: RoleId; turn: number; thinking?: string; text?: string; calls: ToolCall[]; usage?: Usage; costUsd?: number; stopReason?: string }
  | { kind: "approval"; seq: number; ts: string; request: ApprovalRequest; resolved?: { decision: "approve" | "reject"; note?: string } }
  | { kind: "contract"; seq: number; ts: string; by: RoleId | "agreed"; criteria: ContractCriterion[]; rationale?: string }
  | { kind: "evaluation"; seq: number; ts: string; round: number; verdict: "pass" | "fail"; results: CriterionResult[]; summary: string }
  | { kind: "context"; seq: number; ts: string; what: "compacted" | "cleared" | "reset"; role: RoleId; detail: string }
  | { kind: "steer"; seq: number; ts: string; text: string; delivered: boolean }
  | { kind: "commit"; seq: number; ts: string; sha: string; message: string; files: number }
  | { kind: "note"; seq: number; ts: string; level: "info" | "warn" | "error"; text: string }
  | { kind: "summary"; seq: number; ts: string; summary: string; costUsd: number; durationMs: number };

export interface PhaseStat {
  phase: Phase;
  round: number;
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
  contract: ContractCriterion[];
  contractHistory: { by: RoleId; criteria: ContractCriterion[]; rationale: string }[];
  evaluations: { round: number; verdict: "pass" | "fail"; results: CriterionResult[]; summary: string }[];
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
  turnsByRole: Partial<Record<RoleId, number>>;
  costByRole: Partial<Record<RoleId, number>>;
}

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Fold an event log (optionally truncated at a seq for scrubbing) into the view model. */
export function derive(events: RunEvent[], upTo = Infinity): RunModel {
  const m: RunModel = {
    status: "queued",
    phases: [],
    feed: [],
    calls: [],
    contract: [],
    contractHistory: [],
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
    turnsByRole: {},
    costByRole: {},
  };
  const callsById = new Map<string, ToolCall>();
  const pending = new Map<string, ApprovalRequest>();
  let currentTurn: Extract<FeedItem, { kind: "turn" }> | null = null;
  let currentPhaseIdx = -1;

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
        m.phases.push({ phase: ev.phase, round: ev.round, startedTs: ev.ts, costUsd: 0, usage: zeroUsage(), turns: 0 });
        currentPhaseIdx = m.phases.length - 1;
        m.feed.push({ kind: "phase", seq: ev.seq, ts: ev.ts, phase: ev.phase, round: ev.round });
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
        currentTurn = { kind: "turn", seq: ev.seq, ts: ev.ts, role: ev.role, turn: ev.turn, calls: [] };
        m.feed.push(currentTurn);
        m.turnsByRole[ev.role] = (m.turnsByRole[ev.role] ?? 0) + 1;
        if (m.phases[currentPhaseIdx]) m.phases[currentPhaseIdx].turns++;
        break;
      case "turn.finished":
        if (currentTurn && currentTurn.role === ev.role) {
          // Engines may report usage and cost in separate events for one turn.
          if (ev.usage.input + ev.usage.output + ev.usage.cacheRead + ev.usage.cacheWrite > 0) currentTurn.usage = ev.usage;
          currentTurn.costUsd = (currentTurn.costUsd ?? 0) + ev.costUsd;
          if (ev.stopReason) currentTurn.stopReason = ev.stopReason;
        }
        m.costUsd += ev.costUsd;
        m.costByRole[ev.role] = (m.costByRole[ev.role] ?? 0) + ev.costUsd;
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
        currentTurn = null;
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
        currentTurn = null;
        break;
      case "contract.agreed":
        m.contract = ev.criteria;
        m.feed.push({ kind: "contract", seq: ev.seq, ts: ev.ts, by: "agreed", criteria: ev.criteria });
        currentTurn = null;
        break;
      case "evaluation.result":
        m.evaluations.push({ round: ev.round, verdict: ev.verdict, results: ev.results, summary: ev.summary });
        m.feed.push({ kind: "evaluation", seq: ev.seq, ts: ev.ts, round: ev.round, verdict: ev.verdict, results: ev.results, summary: ev.summary });
        currentTurn = null;
        break;
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
        currentTurn = null;
        break;
      case "context.cleared":
        m.contextEvents.push({ seq: ev.seq, role: ev.role, what: "cleared", detail: `${ev.clearedToolResults} tool results, ${Math.round(ev.tokensFreed / 1000)}k tokens freed` });
        m.feed.push({ kind: "context", seq: ev.seq, ts: ev.ts, what: "cleared", role: ev.role, detail: `Cleared ${ev.clearedToolResults} stale tool results (${Math.round(ev.tokensFreed / 1000)}k tokens freed).` });
        currentTurn = null;
        break;
      case "context.reset":
        m.contextEvents.push({ seq: ev.seq, role: ev.role, what: "reset", detail: `fresh conversation from handoff (${Math.round(ev.beforeTokens / 1000)}k tokens before)` });
        m.feed.push({ kind: "context", seq: ev.seq, ts: ev.ts, what: "reset", role: ev.role, detail: ev.handoff });
        currentTurn = null;
        break;
      case "steer.received":
        m.steers.push({ text: ev.text, delivered: false, ts: ev.ts });
        m.feed.push({ kind: "steer", seq: ev.seq, ts: ev.ts, text: ev.text, delivered: false });
        currentTurn = null;
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
        currentTurn = null;
        break;
      case "files.changed":
        m.files = ev.files;
        break;
      case "error":
        m.errors.push(ev.message);
        m.feed.push({ kind: "note", seq: ev.seq, ts: ev.ts, level: "error", text: ev.message });
        currentTurn = null;
        break;
      case "note":
        m.feed.push({ kind: "note", seq: ev.seq, ts: ev.ts, level: ev.level, text: ev.text });
        currentTurn = null;
        break;
      case "run.summary":
        m.summary = { summary: ev.summary, costUsd: ev.costUsd, durationMs: ev.durationMs };
        m.feed.push({ kind: "summary", seq: ev.seq, ts: ev.ts, summary: ev.summary, costUsd: ev.costUsd, durationMs: ev.durationMs });
        break;
    }
  }
  m.pending = [...pending.values()];
  m.currentPhase = m.phases.find((p) => !p.finishedTs) ?? m.phases[m.phases.length - 1];
  return m;
}

export const PHASE_ORDER: Phase[] = ["plan", "contract", "build", "evaluate", "wrapup"];
export const PHASE_LABEL: Record<Phase, string> = { plan: "Plan", contract: "Contract", build: "Build", evaluate: "Evaluate", wrapup: "Wrap up" };
export const ROLE_LABEL: Record<RoleId, string> = { planner: "Planner", builder: "Builder", evaluator: "Evaluator", classifier: "Classifier", scout: "Scout" };
export const isLive = (s: RunStatus) => s === "running" || s === "paused" || s === "waiting_approval" || s === "queued";
