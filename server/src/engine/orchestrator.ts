import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import type { ContractCriterion, CriterionResult, EvaluationOrigin, FeatureItem, Phase, RunConfig, Usage } from "../../../shared/types.js";
import { RunBus } from "./bus.js";
import { AgentLoop, type LoopControl, type LoopOptions, type LoopResult } from "./loop.js";
import { ClaudeCodeLoop } from "./claudeCodeLoop.js";
import { loadSkills, skillsPromptSection } from "../skills.js";
import { HARNESS_VERSION } from "../../../shared/components.js";
import { checkRunConfig } from "../../../shared/config.js";
import { addUsage, emptyUsage } from "./pricing.js";
import { firstMessage, renderContract, systemPromptFor } from "../roles/prompts.js";
import { changedFiles, ensureReinsIgnored, headSha, isGitRepo, readWorkspaceFile, reinsDir, writeWorkspaceFile } from "../workspace.js";
import { runShell } from "../tools/registry.js";
import { EFFORT_TABLE } from "../../../shared/components.js";

/** The evaluate-phase instruction at max effort (EFFORT_TABLE.max.rerunEveryCriterion). */
export const MAX_EFFORT_EVALUATE = "Max effort: run every contract criterion's verification step afresh in this round. Do not reuse evidence from earlier rounds or the builder's summary. Then call report_evaluation with a result for every criterion id; a report that omits one is refused.";

export interface OrchestratorControl extends LoopControl {
  requestPhaseApproval: (title: string, detail: string, payload: unknown) => Promise<{ approved: boolean; note?: string }>;
  requestContractApproval: (criteria: ContractCriterion[]) => Promise<{ approved: boolean; note?: string; criteria?: ContractCriterion[] }>;
}

const READ_TOOLS = ["read_file", "list_files", "search", "think", "git_status", "git_diff", "list_lessons", "read_lesson"]; // http_fetch belongs to the intake librarian only
const WRITE_TOOLS = ["write_file", "edit_file", "bash", "update_progress", "git_commit"];

/**
 * The pipeline: Plan -> Contract -> Build -> Evaluate (-> Build ...) -> Wrap up.
 * Roles hand work to each other through files in .reins/, never shared context.
 */
export class Orchestrator {
  private totalUsage: Usage = emptyUsage();
  private totalCost = 0;
  private features: FeatureItem[] = [];
  private contract: ContractCriterion[] = [];
  private baseSha: string | null = null;
  private builderHistory: Anthropic.Beta.BetaMessageParam[] | undefined;
  private builderSession: string | undefined;
  private startedAt = Date.now();

  constructor(
    private client: Anthropic | null,
    private config: RunConfig,
    private bus: RunBus,
    private control: OrchestratorControl,
  ) {}

  /** Lines every role gets in its first message: project memory, the skills index, and the clock (agents are time-blind). */
  private projectContext(): Record<string, string> {
    const extra: Record<string, string> = {};
    const elapsedMin = Math.round((Date.now() - this.startedAt) / 60000);
    extra["Budget and time"] = `$${Math.max(0, this.config.budgetUsd - this.totalCost).toFixed(2)} of $${this.config.budgetUsd} remaining; ${elapsedMin} minutes elapsed; at most ${this.config.maxTurnsPerPhase} turns in this phase. Pace yourself and leave the workspace clean if you must stop early.`;
    if (this.config.components.projectMemory) {
      for (const f of ["CLAUDE.md", "AGENTS.md"]) {
        const body = readWorkspaceFile(this.config.workspace, f);
        if (body) {
          if (body.length > 6000) this.bus.emitEvent({ type: "note", level: "warn", text: `${f} is ${body.length} characters; only the first 6000 are given to the agents. Shorter project notes work better.` });
          extra[`Project notes (${f})`] = body.length > 6000 ? body.slice(0, 6000) + "\n[... truncated]" : body;
        }
      }
    }
    if (this.config.components.skills) {
      const skills = loadSkills(this.config.workspace);
      for (const sk of skills) {
        if (!sk.description) this.bus.emitEvent({ type: "note", level: "warn", text: `Skill "${sk.name}" has no description, so the agents cannot tell when to use it.` });
        else if (sk.description.length > 240) this.bus.emitEvent({ type: "note", level: "warn", text: `Skill "${sk.name}" has a ${sk.description.length}-character description; keep it to one line so the index stays cheap.` });
      }
      const section = skillsPromptSection(skills);
      if (section) extra.Skills = section.replace(/^# Skills\n/, "");
    }
    return extra;
  }

  get costUsd() {
    return this.totalCost;
  }

  private handlers() {
    return {
      update_progress: (input: { features: FeatureItem[]; note: string }) => {
        this.features = mergeFeatures(this.features, input.features);
        const dir = reinsDir(this.config.workspace);
        if (this.config.components.featureList) fs.writeFileSync(path.join(dir, "features.json"), JSON.stringify(this.features, null, 2));
        if (this.config.components.progressFile) fs.appendFileSync(path.join(dir, "progress.md"), `\n## ${new Date().toISOString()}\n${input.note}\n`);
        this.bus.emitEvent({ type: "progress.updated", features: this.features, note: input.note });
        return `Recorded. ${this.features.filter((f) => f.status === "done").length}/${this.features.length} features done.`;
      },
    };
  }

  private async phase<T>(phase: Phase, round: number, body: () => Promise<{ result: LoopResult | null; summary: string; value: T }>): Promise<T> {
    const started = Date.now();
    this.bus.emitEvent({ type: "phase.started", phase, round });
    const { result, summary, value } = await body();
    const usage = result?.usage ?? emptyUsage();
    const cost = result?.costUsd ?? 0;
    this.totalUsage = addUsage(this.totalUsage, usage);
    this.totalCost += cost;
    this.bus.emitEvent({ type: "phase.finished", phase, round, summary, usage, costUsd: cost, durationMs: Date.now() - started });
    await this.emitChangedFiles();
    return value;
  }

  private async emitChangedFiles() {
    try {
      const files = await changedFiles(this.config.workspace, this.baseSha);
      this.bus.emitEvent({ type: "files.changed", files });
    } catch {
      /* not a git repo */
    }
  }

  private loop(role: "planner" | "builder" | "evaluator", promptRole: Parameters<typeof systemPromptFor>[0], tools: string[], terminal: string[], handlers: Record<string, any>, messages?: Anthropic.Beta.BetaMessageParam[]): { run: (first?: string) => Promise<LoopResult> } {
    const opts: LoopOptions = {
      role,
      system: systemPromptFor(promptRole, this.config),
      // The phase's structured end-of-turn tools must be callable, not only recognised.
      tools: [...new Set([...tools, ...terminal])],
      terminal,
      handlers: { ...this.handlers(), ...handlers },
      maxTurns: this.config.maxTurnsPerPhase,
      messages,
    };
    if (this.config.engine === "claude-code") {
      const cc = new ClaudeCodeLoop(this.config, this.bus, this.control, { ...opts, resumeSessionId: role === "builder" && messages ? this.builderSession : undefined });
      return {
        run: async (first) => {
          const r = await cc.run(first);
          if (role === "builder") this.builderSession = cc.session;
          return r;
        },
      };
    }
    if (!this.client) throw new Error("No API client for the anthropic engine.");
    return new AgentLoop(this.client, this.config, this.bus, this.control, opts);
  }

  private checkStop(r: LoopResult): boolean {
    return r.reason === "aborted" || r.reason === "budget" || r.reason === "refusal" || r.reason === "error";
  }

  async run(): Promise<{ ok: boolean; summary: string }> {
    const ws = this.config.workspace;
    if (!fs.existsSync(ws)) throw new Error(`Workspace does not exist: ${ws}`);
    reinsDir(ws);
    const gitRepo = await isGitRepo(ws);
    if (gitRepo) ensureReinsIgnored(ws);
    this.baseSha = gitRepo ? await headSha(ws) : null;
    this.bus.emitEvent({
      type: "note",
      level: "info",
      text: `Environment: reins ${HARNESS_VERSION}, engine ${this.config.engine}, node ${process.version}, ${process.platform} ${process.arch}, git ${gitRepo ? `repo at ${this.baseSha?.slice(0, 7) ?? "no commits"}` : "not a repository"}.`,
    });
    // Contradictory or ignored settings are recorded, never blocking: one warn note each, before any phase.
    for (const w of checkRunConfig(this.config)) this.bus.emitEvent({ type: "note", level: "warn", text: `Config check: ${w.message}` });
    const existing = readWorkspaceFile(ws, ".reins/features.json");
    if (existing) {
      try {
        this.features = JSON.parse(existing);
        this.bus.emitEvent({ type: "progress.updated", features: this.features, note: "Loaded feature list from a previous session." });
      } catch {
        /* ignore corrupt */
      }
    }

    // ---- Plan ----
    if (this.config.components.planner) {
      const stop = await this.phase("plan", 0, async () => {
        const r = await this.loop("planner", "planner", [...READ_TOOLS, "write_file", "update_progress"], ["finish"], {}).run(
          firstMessage("plan", this.config, { ...this.projectContext(), Instructions: "Explore the workspace, write .reins/spec.md, record the feature list with update_progress, then call finish." }),
        );
        return { result: r, summary: r.terminalInput?.summary ?? r.finalText.slice(0, 300), value: this.checkStop(r) };
      });
      if (stop) return this.finish(false, "Stopped during planning.");
      if (this.config.pauses.afterPlan) {
        const spec = readWorkspaceFile(ws, ".reins/spec.md") ?? "(no spec written)";
        const a = await this.control.requestPhaseApproval("Review the plan", "The planner wrote a spec and feature list. Continue to the contract stage?", { spec, features: this.features });
        if (!a.approved) return this.finish(false, `Plan rejected${a.note ? `: ${a.note}` : "."}`);
      }
    } else {
      writeWorkspaceFile(ws, ".reins/spec.md", `# Spec\n\n${this.config.task}\n\n(Planner disabled for this run; the task is the spec.)\n`);
    }

    // ---- Contract ----
    if (this.config.components.contracts) {
      const stop = await this.phase("contract", 0, async () => {
        let proposed: ContractCriterion[] = [];
        let rationale = "";
        const r1 = await this.loop("builder", "contract_builder", READ_TOOLS, ["propose_contract"], {
          propose_contract: (input: any) => {
            proposed = input.criteria;
            rationale = input.rationale;
            writeWorkspaceFile(ws, ".reins/contract.proposed.json", JSON.stringify(proposed, null, 2));
            this.bus.emitEvent({ type: "contract.proposed", by: "builder", criteria: proposed, rationale });
            return "Proposed.";
          },
        }).run(firstMessage("contract", this.config, { ...this.projectContext(), Instructions: "Read the spec and feature list, inspect the codebase, then call propose_contract." }));
        if (this.checkStop(r1)) return { result: r1, summary: "Stopped.", value: true };
        let usage = r1.usage;
        let cost = r1.costUsd;
        let final = proposed;
        if (this.config.components.evaluator && proposed.length) {
          const r2 = await this.loop("evaluator", "contract_evaluator", READ_TOOLS, ["review_contract"], {
            review_contract: (input: any) => {
              final = input.criteria?.length ? input.criteria : proposed;
              this.bus.emitEvent({ type: "contract.proposed", by: "evaluator", criteria: final, rationale: input.feedback });
              return "Reviewed.";
            },
          }).run(firstMessage("contract review", this.config, { ...this.projectContext(), "Proposed contract": renderContract(proposed), Instructions: "Review and call review_contract with the final criteria." }));
          usage = addUsage(usage, r2.usage);
          cost += r2.costUsd;
          if (this.checkStop(r2)) return { result: { ...r2, usage, costUsd: cost }, summary: "Stopped.", value: true };
        }
        if (!final.length) final = [{ id: "C1", text: "The task as described is complete", verify: "Inspect the result", hard: true }];
        if (this.config.pauses.afterContract) {
          const a = await this.control.requestContractApproval(final);
          if (!a.approved) return { result: { ...r1, usage, costUsd: cost }, summary: `Contract rejected${a.note ? `: ${a.note}` : "."}`, value: true };
          if (a.criteria?.length) final = a.criteria;
        }
        this.contract = final;
        writeWorkspaceFile(ws, ".reins/contract.json", JSON.stringify(final, null, 2));
        this.bus.emitEvent({ type: "contract.agreed", criteria: final });
        return { result: { ...r1, usage, costUsd: cost }, summary: `${final.length} criteria agreed (${final.filter((c) => c.hard).length} hard).`, value: false };
      });
      if (stop) return this.finish(false, "Stopped at the contract stage.");
    } else {
      this.contract = [{ id: "C1", text: "The task as described is complete and verified by running the result", verify: "Run the program / tests and inspect", hard: true }];
      writeWorkspaceFile(ws, ".reins/contract.json", JSON.stringify(this.contract, null, 2));
    }

    // ---- Build / Evaluate rounds ----
    let lastEval: Evaluation | null = null;
    for (let round = 1; round <= this.config.maxFixRounds + 1; round++) {
      const stop = await this.phase("build", round, async () => {
        const ctx = this.projectContext();
        const extra: Record<string, string> = { ...(this.builderHistory ? { "Budget and time": ctx["Budget and time"] } : ctx), Contract: renderContract(this.contract) };
        if (lastEval) extra["Evaluation of the previous round"] = renderEvaluationForBuilder(lastEval);
        else extra.Instructions = "Follow the session preamble, then implement the features. Call finish only when every hard criterion's verification step has been run and passed.";
        if (this.config.components.selfVerification) extra["Self-verification"] = "Before finish, run each criterion's verify step yourself and include the observed result in your summary.";
        const loop = this.loop("builder", "builder", [...READ_TOOLS, ...WRITE_TOOLS], ["finish"], {}, this.shouldResetBuilder() ? undefined : this.builderHistory);
        const r = await loop.run(firstMessage(lastEval ? `build (fix round ${round - 1})` : "build", this.config, extra));
        this.builderHistory = this.config.engine === "claude-code" ? (r.messages.length ? r.messages : [{ role: "user", content: "(claude-code session)" }]) : r.messages;
        return { result: r, summary: r.terminalInput?.summary ?? r.finalText.slice(0, 300), value: this.checkStop(r) };
      });
      if (stop) return this.finish(false, "Stopped while building.");

      if (this.config.components.gitCommits) await this.commit(`reins: ${lastEval ? `fix round ${round - 1}` : "build"} — ${this.config.title}`);

      if (!this.config.components.evaluator) break;

      const rerunAll = !!this.config.effort && EFFORT_TABLE[this.config.effort].rerunEveryCriterion;
      const result = await this.phase("evaluate", round, async () => {
        let reported: { results: CriterionResult[]; summary: string } | null = null;
        const r = await this.loop("evaluator", "evaluator", [...READ_TOOLS, "bash"], ["report_evaluation"], {
          report_evaluation: (input: any) => {
            // An unverified criterion is never a pass, whatever the model put in `pass`.
            const results: CriterionResult[] = (Array.isArray(input.results) ? input.results : []).map((x: any) => ({ ...x, pass: x.unverified ? false : x.pass === true }));
            if (rerunAll) {
              // Max effort: an evaluation that leaves out a criterion is refused, so the evaluator reports again.
              const missing = this.contract.filter((c) => !results.some((x) => x.id === c.id)).map((c) => c.id);
              if (missing.length) throw new Error(`Refused at max effort: the report omits criteria ${missing.join(", ")}. Run their verification steps afresh and call report_evaluation again with every criterion.`);
            }
            reported = { results, summary: String(input.summary ?? "") };
            return `Recorded: ${this.verdictFor(results)}.`;
          },
        }).run(
          firstMessage("evaluate", this.config, {
            ...this.projectContext(),
            Contract: renderContract(this.contract),
            Instructions: `${rerunAll ? MAX_EFFORT_EVALUATE : "Verify every criterion yourself, then call report_evaluation."} You have at most ${this.config.maxTurnsPerPhase} turns in this phase: when an operator message says the budget is nearly spent, report at once and mark whatever is unchecked as unverified.`,
          }),
        );
        if (this.checkStop(r)) return { result: r, summary: "Stopped.", value: { stop: true, ev: null as Evaluation | null } };
        let ev: Evaluation;
        if (reported) {
          const { results, summary } = reported as { results: CriterionResult[]; summary: string };
          ev = { results, verdict: this.verdictFor(results), summary, origin: r.forced ? "forced" : "reported", verified: verifiedCount(results) };
          if (r.forced) this.bus.emitEvent({ type: "note", level: "warn", text: `The evaluator reported only in the forced final call: ${ev.verified} of ${this.contract.length} criteria verified, the rest unverified. ${TURNS_ADVICE}` });
        } else {
          // Neither the nudges nor the forced call produced a report: the harness writes one, so the fix round has something to work from.
          const why = r.reason === "max_turns" ? `the evaluator ran out of turns (${this.config.maxTurnsPerPhase}) before reporting` : `the evaluator ended its turn (${r.reason}) without reporting`;
          const results: CriterionResult[] = this.contract.map((c) => ({ id: c.id, pass: false, unverified: true, evidence: `Not verified: ${why}.` }));
          const last = r.finalText.trim();
          const summary = `No evaluation report: ${why}; 0 of ${this.contract.length} criteria were verified. ${TURNS_ADVICE}${last ? `\n\nThe evaluator's last words: ${last.slice(0, 2000)}` : ""}`;
          ev = { results, verdict: this.verdictFor(results), summary, origin: "synthesised", verified: 0 };
          this.bus.emitEvent({ type: "note", level: "warn", text: `The evaluator did not call report_evaluation even in the forced final call; a report was synthesised with every criterion unverified. ${TURNS_ADVICE}` });
        }
        writeWorkspaceFile(ws, ".reins/evaluation.md", `# Evaluation round ${round}${ev.origin === "reported" ? "" : ` (${ev.origin} report)`}\n\n${ev.summary}\n\n${ev.results.map((x) => `- ${x.id}: ${x.pass ? "PASS" : x.unverified ? "UNVERIFIED" : "FAIL"} — ${x.evidence}`).join("\n")}\n`);
        this.bus.emitEvent({ type: "evaluation.result", round, results: ev.results, verdict: ev.verdict, summary: ev.summary, origin: ev.origin });
        return { result: r, summary: `${ev.verdict.toUpperCase()}${ev.origin === "reported" ? "" : ` (${ev.origin} report)`}: ${ev.summary}`, value: { stop: false, ev: ev as Evaluation | null } };
      });
      if (result.stop || !result.ev) return this.finish(false, "Stopped while evaluating.");
      lastEval = result.ev;
      if (this.config.pauses.afterEvaluation) {
        const a = await this.control.requestPhaseApproval("Evaluation complete", `Verdict: ${lastEval.verdict}. Continue?`, lastEval);
        if (!a.approved) return this.finish(false, "Stopped after evaluation.");
      }
      if (lastEval.verdict === "pass") break;
      if (round === this.config.maxFixRounds + 1) {
        // A forced report says what the evaluator verified; the synthesised summary already says why there was no report.
        const why = lastEval.origin === "forced" ? `the evaluator ran out of turns (${this.config.maxTurnsPerPhase}) before reporting on its own; ${lastEval.verified} of ${this.contract.length} criteria were verified. ${TURNS_ADVICE} ` : "";
        return this.finish(false, `Evaluation still failing after ${this.config.maxFixRounds} fix rounds: ${why}${lastEval.summary}`);
      }
    }

    // ---- Wrap up ----
    await this.phase("wrapup", 0, async () => {
      const done = this.features.filter((f) => f.status === "done").length;
      if (lastEval?.verdict === "pass" && done < this.features.length)
        this.bus.emitEvent({ type: "note", level: "warn", text: `The evaluation passed but features.json still lists ${this.features.length - done} of ${this.features.length} features as not done: the builder did not keep the list current. The next session will re-read it, so check it before resuming.` });
      if (this.config.components.progressFile) {
        fs.appendFileSync(path.join(reinsDir(ws), "progress.md"), `\n## ${new Date().toISOString()} — run ${this.config.id} finished\nVerdict: ${lastEval?.verdict ?? "n/a"}. ${done}/${this.features.length} features done.\n`);
      }
      return { result: null, summary: `${done}/${this.features.length} features done.`, value: null };
    });
    return this.finish(true, lastEval ? lastEval.summary : "Build finished.");
  }

  /** A hard criterion that was not observed to pass (failed or unverified) fails the sprint. */
  private verdictFor(results: CriterionResult[]): "pass" | "fail" {
    return this.contract.some((c) => c.hard && results.find((r) => r.id === c.id)?.pass !== true) ? "fail" : "pass";
  }

  private shouldResetBuilder(): boolean {
    if (!this.builderHistory) return true;
    if (!this.config.components.resetWithHandoff) return false;
    const est = JSON.stringify(this.builderHistory).length / 3.6;
    if (est > this.config.context.resetAtTokens) {
      const handoff = readWorkspaceFile(this.config.workspace, ".reins/progress.md") ?? "";
      this.bus.emitEvent({ type: "context.reset", role: "builder", handoff: handoff.slice(-3000), beforeTokens: Math.round(est) });
      return true;
    }
    return false;
  }

  private async commit(message: string) {
    const ws = this.config.workspace;
    if (!(await isGitRepo(ws))) return;
    if (this.config.pauses.beforeCommit) {
      const a = await this.control.requestPhaseApproval("Commit changes?", message, await changedFiles(ws, this.baseSha));
      if (!a.approved) return;
    }
    const r = await runShell(`git add -A && git diff --cached --quiet && echo NOCHANGES || (git -c user.name="Reins" -c user.email="reins@localhost" commit -q -m ${JSON.stringify(message)} && git rev-parse --short HEAD && git show --stat --format= HEAD | tail -1)`, ws, this.control.signal, 30_000);
    if (r.out.includes("NOCHANGES")) return;
    const lines = r.out.trim().split("\n");
    const sha = lines[0] ?? "";
    const files = Number(lines[1]?.match(/(\d+) files? changed/)?.[1] ?? 0);
    if (r.code === 0 && sha) this.bus.emitEvent({ type: "git.commit", sha, message, files });
    else this.bus.emitEvent({ type: "note", level: "warn", text: `Commit failed: ${r.out.trim().slice(0, 300)}` });
  }

  private finish(ok: boolean, summary: string) {
    this.bus.emitEvent({ type: "run.summary", summary, costUsd: this.totalCost, durationMs: Date.now() - this.startedAt });
    return { ok, summary };
  }
}

interface Evaluation {
  results: CriterionResult[];
  verdict: "pass" | "fail";
  summary: string;
  origin: EvaluationOrigin;
  /** Criteria the evaluator actually checked (pass or fail), as opposed to left unverified. */
  verified: number;
}

const TURNS_ADVICE = "Raise maxTurnsPerPhase for the evaluate phase or reduce the number of contract criteria.";

function verifiedCount(results: CriterionResult[]): number {
  return results.filter((r) => !r.unverified).length;
}

/** The previous round's verdict as the builder's fix-round brief: failures to fix, unverified criteria to re-verify, never an empty list. */
export function renderEvaluationForBuilder(ev: { results: CriterionResult[]; summary: string; origin?: EvaluationOrigin }): string {
  const open = ev.results.filter((r) => !r.pass);
  const lines = open.map((r) => `- ${r.id} ${r.unverified ? "UNVERIFIED" : "FAILED"}: ${r.evidence}`);
  const unverified = open.some((r) => r.unverified);
  const note = ev.origin && ev.origin !== "reported" ? `(This report was ${ev.origin === "forced" ? "forced out of the evaluator at its turn cap" : "synthesised by the harness because the evaluator ran out of turns without reporting"}.)\n\n` : "";
  const todo = unverified
    ? "Criteria marked UNVERIFIED were not checked, because the evaluator ran out of turns; nothing is known to be wrong with them. Fix the failures, then run the verification step of every failed or unverified criterion yourself and record the observed result, update progress, then call finish."
    : "Fix the failures, re-run the verification steps, update progress, then call finish.";
  return `${note}${ev.summary}\n\n${lines.join("\n")}\n\n${todo}`;
}

export function mergeFeatures(existing: FeatureItem[], incoming: FeatureItem[]): FeatureItem[] {
  // Features are never deleted, only updated or added (the feature list lesson).
  const byId = new Map(existing.map((f) => [f.id, f]));
  for (const f of incoming) {
    const prev = byId.get(f.id);
    // Only status and note may change on a known feature; a renamed feature is a rewritten plan.
    byId.set(f.id, prev ? { ...prev, status: f.status, note: f.note ?? prev.note } : f);
  }
  return [...byId.values()];
}
