import path from "node:path";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { EventEmitter } from "node:events";
import type { ApprovalDecision, ApprovalRequest, ContractCriterion, PublishDraft, RunConfig, RunEvent, RunSummary } from "../../../shared/types.js";
import { defaultRunConfig } from "../../../shared/components.js";
import { RunBus } from "./bus.js";
import { Orchestrator, type OrchestratorControl } from "./orchestrator.js";
import { listRunIds, loadConfig, readEvents, REINS_HOME, saveConfig, summarize, deleteRun as deleteRunDir } from "../store/runStore.js";
import { startReplay } from "./replay.js";
import { execFileSync } from "node:child_process";
import { budgetOf } from "../../../shared/budget.js";
import { resolveRunInput } from "../presets.js";

/** Events that change a run's summary row (phase, round, cost), so the run list is pushed again. */
const SUMMARY_EVENTS = new Set<RunEvent["type"]>(["phase.started", "phase.finished", "turn.finished", "run.summary"]);

/** What the person answered on an approval card. `approved` is `decision === "approve"`; the extras depend on the card's kind. */
interface ApprovalAnswer {
  decision: ApprovalDecision;
  approved: boolean;
  note?: string;
  /** Contract cards: the criteria as edited. */
  criteria?: ContractCriterion[];
  /** Publish cards: the title and body as edited. */
  draft?: PublishDraft;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (r: ApprovalAnswer) => void;
}

interface ActiveRun {
  config: RunConfig;
  bus: RunBus;
  abort: AbortController;
  paused: boolean;
  pauseWaiters: (() => void)[];
  steer: string[];
  pending: Map<string, PendingApproval>;
  costUsd: () => number;
  /** Tokens spent so far as a subscription counts them (the Claude Code budget's unit). */
  tokens: () => number;
}

/** Owns every live run: creation, approvals, steering, pause/cancel, and the fan-out of events. */
export class RunManager extends EventEmitter {
  private active = new Map<string, ActiveRun>();
  /** Minimum gap between two "runs" pushes, across all runs. */
  runsThrottleMs = 1000;
  private lastRunsEmit = 0;
  private runsTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Ask for a "runs" push (the sidebar list). Throttled across all runs to at
   * most one per runsThrottleMs: the first call goes out at once, later calls
   * in the window collapse into one trailing push so the last state is sent.
   */
  notifyRuns() {
    if (this.runsTimer) return;
    const wait = this.lastRunsEmit + this.runsThrottleMs - Date.now();
    const fire = () => {
      this.runsTimer = null;
      this.lastRunsEmit = Date.now();
      this.emit("runs");
    };
    if (wait <= 0) fire();
    else this.runsTimer = setTimeout(fire, wait);
  }
  private _client: Anthropic | null = null;
  get client(): Anthropic | null {
    return this._client;
  }
  private set client(v: Anthropic | null) {
    this._client = v;
  }

  constructor() {
    super();
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) this.client = new Anthropic();
    this.markInterrupted();
  }

  /** A run that was live when the server last stopped cannot be resumed mid-phase; say so instead of showing it as running forever. */
  private markInterrupted() {
    for (const id of listRunIds()) {
      const cfg = loadConfig(id);
      if (!cfg) continue;
      const s = summarize(cfg, readEvents(id));
      if (s.status === "running" || s.status === "paused" || s.status === "waiting_approval" || s.status === "queued") {
        const bus = new RunBus(id);
        bus.emitEvent({ type: "run.status", status: "failed", reason: "Interrupted: the Reins server restarted while this run was live. Start it again to retry (progress notes in .reins/ carry over)." });
      }
    }
  }

  get hasApiKey() {
    return !!this.client;
  }

  private _hasClaudeCode: boolean | null = null;
  /** The claude-code engine needs the Claude Code CLI with a login on this machine. */
  get hasClaudeCode(): boolean {
    if (this._hasClaudeCode !== null) return this._hasClaudeCode;
    try {
      execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 10_000 });
      this._hasClaudeCode = true;
    } catch {
      this._hasClaudeCode = false;
    }
    return this._hasClaudeCode;
  }

  setApiKey(key: string) {
    process.env.ANTHROPIC_API_KEY = key;
    this.client = new Anthropic({ apiKey: key });
  }

  listRuns(): RunSummary[] {
    const out: RunSummary[] = [];
    for (const id of listRunIds()) {
      const cfg = loadConfig(id);
      if (!cfg) continue;
      out.push(summarize(cfg, readEvents(id)));
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  events(id: string, fromSeq = 0): RunEvent[] {
    return readEvents(id, fromSeq);
  }

  config(id: string) {
    return loadConfig(id);
  }

  deleteRun(id: string) {
    if (this.active.has(id)) throw new Error("Run is still active; cancel it first.");
    deleteRunDir(id);
    this.notifyRuns();
  }

  private attach(config: RunConfig): ActiveRun {
    const bus = new RunBus(config.id);
    const run: ActiveRun = { config, bus, abort: new AbortController(), paused: false, pauseWaiters: [], steer: [], pending: new Map(), costUsd: () => 0, tokens: () => 0 };
    bus.on("event", (ev: RunEvent) => {
      this.emit("event", ev);
      if (SUMMARY_EVENTS.has(ev.type)) this.notifyRuns();
    });
    this.active.set(config.id, run);
    return run;
  }

  createRun(input: Partial<RunConfig> & { task: string; workspace: string }, opts: { verbatim?: boolean } = {}): RunConfig {
    // Effort + Supervision + domains compose here, and the stage lessons are resolved and recorded on the config.
    const config = defaultRunConfig({ ...resolveRunInput(input, opts), id: nanoid(10) });
    saveConfig(config);
    const run = this.attach(config);
    run.bus.emitEvent({ type: "run.created", config });
    this.notifyRuns();
    if (config.engine === "replay") this.startReplayRun(run);
    else this.startLiveRun(run);
    return config;
  }

  private status(run: ActiveRun, status: RunSummary["status"], reason?: string) {
    run.bus.emitEvent({ type: "run.status", status, reason });
    this.notifyRuns();
  }

  /** Resolves when the run is not paused. */
  private waitIfPaused(run: ActiveRun): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!run.paused) return resolve();
      run.pauseWaiters.push(resolve);
    });
  }

  /**
   * Put an approval card on the Stage and wait for the answer. A cancel
   * resolves it as rejected; afterwards the run shows running again (or paused,
   * when it was paused while waiting).
   */
  private async ask(run: ActiveRun, request: Omit<ApprovalRequest, "approvalId">): Promise<ApprovalAnswer> {
    const cancelled: ApprovalAnswer = { decision: "reject", approved: false, note: "cancelled" };
    const r = await new Promise<ApprovalAnswer>((resolve) => {
      if (run.abort.signal.aborted) return resolve(cancelled);
      const approvalId = nanoid(8);
      const full = { ...request, approvalId };
      const onAbort = () => resolve(cancelled);
      run.pending.set(approvalId, {
        request: full,
        resolve: (answer) => {
          run.abort.signal.removeEventListener("abort", onAbort);
          resolve(answer);
        },
      });
      run.bus.emitEvent({ type: "approval.requested", request: full });
      this.status(run, "waiting_approval");
      run.abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    if (!run.abort.signal.aborted) this.status(run, run.paused ? "paused" : "running");
    return r;
  }

  private control(run: ActiveRun): OrchestratorControl {
    return {
      signal: run.abort.signal,
      waitIfPaused: () => this.waitIfPaused(run),
      drainSteer: () => run.steer.splice(0),
      remainingBudget: () => {
        const b = budgetOf(run.config);
        return b.kind === "tokens" ? b.limit - run.tokens() : b.limit - run.costUsd();
      },
      requestApproval: (_kind, title, detail, payload) => this.ask(run, { kind: "action", title, detail, payload }),
      requestPhaseApproval: (title, detail, payload) => this.ask(run, { kind: "phase", title, detail, payload }),
      requestContractApproval: (criteria) => this.ask(run, { kind: "contract", title: "Approve the definition of done", detail: "Edit, remove or add criteria, then approve. The evaluator will hold the builder to exactly this list.", payload: criteria }),
      requestPublishApproval: async (draft, detail) => {
        const what = detail.package ? `${detail.package.id}: ${detail.package.title}` : "this package";
        const a = await this.ask(run, {
          kind: "publish",
          title: `Review the pull request for ${what}`,
          detail: `Edit the title and description, then approve to push ${detail.branch} and open the pull request onto ${detail.base}. Or write what should change and request changes: the builder redrafts and this card comes back. Reject leaves the branch local and ends the run.`,
          payload: { ...draft, branch: detail.branch, base: detail.base, revision: detail.revision, ...(detail.package ? { package: detail.package } : {}) },
        });
        return { decision: a.decision, note: a.note, draft: a.draft };
      },
    };
  }

  private async startLiveRun(run: ActiveRun) {
    if (run.config.engine === "anthropic" && !this.client) {
      this.status(run, "failed", "No API key configured. Add one in Settings, switch the engine to Claude Code, or watch the recorded demo.");
      run.bus.emitEvent({ type: "error", message: "No ANTHROPIC_API_KEY. Open Settings to add one, pick the Claude Code engine, or start the demo run.", recoverable: false });
      this.active.delete(run.config.id);
      return;
    }
    if (run.config.engine === "claude-code" && !this.hasClaudeCode) {
      this.status(run, "failed", "The Claude Code engine needs the claude CLI: install it (npm install -g @anthropic-ai/claude-code), run `claude login`, then start the run again.");
      run.bus.emitEvent({ type: "error", message: "The Claude Code engine needs the `claude` CLI installed and logged in: npm install -g @anthropic-ai/claude-code, then `claude login`.", recoverable: false });
      this.active.delete(run.config.id);
      return;
    }
    this.status(run, "running");
    const orch = new Orchestrator(this.client, run.config, run.bus, this.control(run));
    run.costUsd = () => orch.costUsd;
    run.tokens = () => orch.tokens;
    try {
      const { ok, summary } = await orch.run();
      if (run.abort.signal.aborted) this.status(run, "cancelled", summary);
      else this.status(run, ok ? "completed" : "failed", summary);
    } catch (err) {
      run.bus.emitEvent({ type: "error", message: (err as Error).message, recoverable: false, detail: (err as Error).stack });
      this.status(run, run.abort.signal.aborted ? "cancelled" : "failed", (err as Error).message);
    } finally {
      this.active.delete(run.config.id);
    }
  }

  private async startReplayRun(run: ActiveRun) {
    this.status(run, "running");
    try {
      await startReplay(run.bus, run.config, {
        signal: run.abort.signal,
        waitIfPaused: () => this.waitIfPaused(run),
        drainSteer: () => run.steer.splice(0),
        ask: (request) => this.ask(run, request),
      });
      this.status(run, run.abort.signal.aborted ? "cancelled" : "completed", "Replay finished.");
    } finally {
      this.active.delete(run.config.id);
    }
  }

  /** The live run, or an error that says why there is none. */
  private live(runId: string): ActiveRun {
    const run = this.active.get(runId);
    if (!run) throw new Error(`Run ${runId} is not running (it finished, was stopped, or the server restarted). Use Run again to start a new one.`);
    return run;
  }

  /** Answer a pending card. `revise` only means something on a publish card; elsewhere it counts as a rejection. */
  approve(runId: string, approvalId: string, decision: ApprovalDecision, note?: string, extra: { criteria?: ContractCriterion[]; draft?: PublishDraft } = {}) {
    const run = this.active.get(runId);
    const p = run?.pending.get(approvalId);
    if (!run || !p) throw new Error("That approval is no longer pending: it was already decided, the run finished, or the server restarted. Reload to see the current state.");
    if (decision === "revise" && p.request.kind !== "publish") throw new Error("Only a pull request draft can be sent back for changes.");
    run.pending.delete(approvalId);
    run.bus.emitEvent({ type: "approval.resolved", approvalId, decision, note });
    p.resolve({ decision, approved: decision === "approve", note, criteria: extra.criteria, draft: extra.draft });
  }

  steer(runId: string, text: string) {
    const run = this.live(runId);
    run.steer.push(text);
    run.bus.emitEvent({ type: "steer.received", text, deliveredTo: "next" });
  }

  pause(runId: string) {
    const run = this.live(runId);
    run.paused = true;
    this.status(run, "paused");
  }

  resume(runId: string) {
    const run = this.live(runId);
    run.paused = false;
    run.pauseWaiters.splice(0).forEach((w) => w());
    this.status(run, run.pending.size ? "waiting_approval" : "running");
  }

  cancel(runId: string) {
    const run = this.live(runId);
    run.abort.abort();
    run.paused = false;
    run.pauseWaiters.splice(0).forEach((w) => w());
  }

  /** Launch k more runs with the same config, one after another (never in parallel on one workspace). */
  async repeat(runId: string, k: number, fresh = false): Promise<string[]> {
    const base = loadConfig(runId);
    if (!base) throw new Error("No such run.");
    const ids: string[] = [];
    for (let i = 0; i < k; i++) {
      // Fresh trials are isolated: a detached git worktree of the original at HEAD with an empty .reins/,
      // so one trial cannot read the previous one's notes (the evals lesson). Grouped under the origin.
      let workspace = base.workspace;
      let origin: RunConfig["origin"];
      if (fresh) {
        const dir = path.join(REINS_HOME, "worktrees", `${runId}-${nanoid(6)}`);
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        try {
          execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: base.workspace, stdio: "pipe", timeout: 60_000 });
          workspace = dir;
          origin = { workspace: base.origin?.workspace ?? base.workspace, fresh: true };
        } catch (e) {
          throw new Error(`Could not create a fresh worktree from ${base.workspace}: ${(e as Error).message.slice(0, 200)}`);
        }
      }
      // Verbatim: a trial set needs identical configs, ablations (and a legacy run's offs) included.
      const cfg = this.createRun({ ...base, id: undefined as any, createdAt: undefined as any, title: base.title, workspace, origin }, { verbatim: true });
      ids.push(cfg.id);
      await new Promise<void>((resolve) => {
        const check = () => (this.active.has(cfg.id) ? setTimeout(check, 1000) : resolve());
        setTimeout(check, 1000);
      });
    }
    return ids;
  }

  pendingApprovals(runId: string): ApprovalRequest[] {
    return [...(this.active.get(runId)?.pending.values() ?? [])].map((p) => p.request);
  }

  isActive(runId: string) {
    return this.active.has(runId);
  }
}
