import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import type { ContractCriterion, CriterionResult, EvaluationOrigin, FeatureItem, PackageRef, Phase, RunConfig, TestPlan, Usage, WorkPackage } from "../../../shared/types.js";
import { RunBus } from "./bus.js";
import { AgentLoop, type LoopControl, type LoopOptions, type LoopResult } from "./loop.js";
import { ClaudeCodeLoop } from "./claudeCodeLoop.js";
import { loadSkills, skillsPromptSection } from "../skills.js";
import { HARNESS_VERSION } from "../../../shared/components.js";
import { checkRunConfig } from "../../../shared/config.js";
import { addUsage, emptyUsage } from "./pricing.js";
import { firstMessage, renderContract, systemPromptFor, type PromptRole } from "../roles/prompts.js";
import { packageLabel, packageRef, renderBreakdown, renderPackage, singlePackage, validateBreakdown, PACKAGE_MAX_LINES } from "../../../shared/packages.js";
import { renderTestPlanDoc, renderTestsForBuilder, testsCriterion, validateTestPlan } from "../../../shared/testPlan.js";
import { branchNameFor, collectFeedback, prState, Publisher, renderFeedbackForBuilder, renderPrBody, sleep } from "./publish.js";
import { DEFAULT_PUBLISH } from "../../../shared/components.js";
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
 * The pipeline: Plan -> Breakdown -> per work package [Contract -> Build -> Evaluate (-> Build ...)] -> Wrap up.
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

  private publisher: Publisher;
  private sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Set when the publish stage can run here: the remote, its URL and the base branch pull requests target. */
  private publishing: { remote: string; url: string; base: string } | null = null;
  /** The current package's branch and the base sha it was cut from. */
  private branch: { name: string; baseSha: string } | null = null;

  constructor(
    private client: Anthropic | null,
    private config: RunConfig,
    private bus: RunBus,
    private control: OrchestratorControl,
    deps: { publisher?: Publisher; sleep?: (ms: number, signal: AbortSignal) => Promise<void> } = {},
  ) {
    this.publisher = deps.publisher ?? new Publisher();
    this.sleep = deps.sleep ?? sleep;
  }

  private get publishPolicy() {
    return { ...DEFAULT_PUBLISH, ...(this.config.publish ?? {}) };
  }

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

  /** The work package the current contract/build/evaluate phases belong to; unset outside the package loop and for an implicit single package. */
  private pkg: PackageRef | undefined;
  /** The agreed breakdown, or null when the run is one implicit package. */
  private packages: WorkPackage[] | null = null;
  /** The current package's tests-stage plan, once agreed. */
  private testPlan: TestPlan | null = null;

  private async phase<T>(phase: Phase, round: number, body: () => Promise<{ result: LoopResult | null; summary: string; value: T }>): Promise<T> {
    const started = Date.now();
    const pkgField = this.pkg ? { package: this.pkg } : {};
    this.bus.emitEvent({ type: "phase.started", phase, round, ...pkgField });
    const { result, summary, value } = await body();
    const usage = result?.usage ?? emptyUsage();
    const cost = result?.costUsd ?? 0;
    this.totalUsage = addUsage(this.totalUsage, usage);
    this.totalCost += cost;
    this.bus.emitEvent({ type: "phase.finished", phase, round, ...pkgField, summary, usage, costUsd: cost, durationMs: Date.now() - started });
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

  private loop(role: "planner" | "builder" | "evaluator", promptRole: PromptRole, tools: string[], terminal: string[], handlers: Record<string, any>, messages?: Anthropic.Beta.BetaMessageParam[]): { run: (first?: string) => Promise<LoopResult> } {
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
    // Publishing needs a remote and a gh login; without them the run says so once and builds on the current branch.
    if (this.config.components.publish) {
      const policy = this.publishPolicy;
      const c = gitRepo ? await this.publisher.check(ws, policy.remote, this.control.signal) : ({ ok: false, reason: "the workspace is not a git repository" } as const);
      if (c.ok) {
        this.publishing = { remote: policy.remote, url: c.url, base: policy.base ?? c.base };
        this.bus.emitEvent({ type: "note", level: "info", text: `Publishing to ${policy.remote} (${c.url}): one branch and pull request per package onto ${this.publishing.base}; merge when ${policy.mergeWhen === "approved" ? "approved with green checks" : policy.mergeWhen === "checks" ? "checks are green" : "never (pull requests stay open and stack)"}.` });
      } else this.bus.emitEvent({ type: "note", level: "warn", text: `Publish skipped: ${c.reason}; packages are built on the current branch and nothing is pushed.` });
    }
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

      // ---- Breakdown ----
      if (this.config.components.workPackages) {
        if (!this.features.length) this.bus.emitEvent({ type: "note", level: "warn", text: "The planner recorded no features, so there is nothing to slice: the breakdown stage is skipped and the run is one package." });
        else {
          const stop = await this.phase("breakdown", 0, async () => {
            const state: { agreed: WorkPackage[] | null } = { agreed: null };
            const r = await this.loop("planner", "breakdown_planner", READ_TOOLS, ["propose_breakdown"], {
              propose_breakdown: (input: any) => {
                const v = validateBreakdown(input?.packages, this.features);
                if (v.problems.length) throw new Error(`Refused: ${v.problems.join(" ")} Fix these and call propose_breakdown again.`);
                state.agreed = v.packages;
                writeWorkspaceFile(ws, ".reins/packages.json", JSON.stringify(v.packages, null, 2));
                this.bus.emitEvent({ type: "breakdown.agreed", packages: v.packages, rationale: String(input?.rationale ?? "") });
                return `Agreed: ${v.packages.length} package${v.packages.length === 1 ? "" : "s"}.`;
              },
            }).run(
              firstMessage("breakdown", this.config, {
                ...this.projectContext(),
                "Feature list": this.features.map((f) => `${f.id}: ${f.title}`).join("\n"),
                Instructions: `Read the spec, group the features into work packages of at most ${PACKAGE_MAX_LINES} changed lines each, then call propose_breakdown.`,
              }),
            );
            if (this.checkStop(r)) return { result: r, summary: "Stopped.", value: true };
            const got = state.agreed;
            if (got) this.packages = got;
            else this.bus.emitEvent({ type: "note", level: "warn", text: "The planner did not propose a breakdown; the run continues as one package." });
            return { result: r, summary: got ? `${got.length} packages: ${got.map((p) => p.id).join(", ")}.` : "No breakdown.", value: false };
          });
          if (stop) return this.finish(false, "Stopped during the breakdown.");
        }
      }

      if (this.config.pauses.afterPlan) {
        const spec = readWorkspaceFile(ws, ".reins/spec.md") ?? "(no spec written)";
        const pk = this.packages;
        const detail = pk ? `The planner wrote a spec and feature list and cut them into ${pk.length} work packages. Continue to the first contract?` : "The planner wrote a spec and feature list. Continue to the contract stage?";
        const a = await this.control.requestPhaseApproval("Review the plan", detail, { spec, features: this.features, ...(pk ? { packages: pk, breakdown: renderBreakdown(pk, this.features) } : {}) });
        if (!a.approved) return this.finish(false, `Plan rejected${a.note ? `: ${a.note}` : "."}`);
      }
    } else {
      writeWorkspaceFile(ws, ".reins/spec.md", `# Spec\n\n${this.config.task}\n\n(Planner disabled for this run; the task is the spec.)\n`);
    }

    // ---- Per package: contract, build, evaluate ----
    // Without a breakdown the whole run is one implicit package, and the phases carry no package.
    const explicit = !!this.packages;
    const list = this.packages ?? singlePackage(this.config.title, this.features);
    let lastEval: Evaluation | null = null;
    for (let pi = 0; pi < list.length; pi++) {
      const pkg = list[pi];
      this.pkg = explicit ? packageRef(list, pi) : undefined;
      // A new package starts the builder from a fresh conversation; progress notes carry what it needs.
      if (pi > 0) {
        this.builderHistory = undefined;
        this.builderSession = undefined;
      }
      const pkgBrief: Record<string, string> = this.pkg ? { "Work package": `${packageLabel(this.pkg)}\n${renderPackage(pkg, this.features)}` } : {};
      const failed = (summary: string) => this.finish(false, this.pkg ? `Package ${this.pkg.id} (${this.pkg.title}): ${summary}` : summary);
      if (this.publishing) {
        // Every package starts from the freshly pulled base, on its own branch.
        const name = branchNameFor(this.config.id, pkg.id, pkg.title);
        try {
          const baseSha = await this.publisher.startBranch(ws, this.publishing.remote, this.publishing.base, name, this.control.signal);
          this.branch = { name, baseSha };
          this.baseSha = baseSha;
          this.bus.emitEvent({ type: "note", level: "info", text: `Branch ${name} cut from ${this.publishing.base} at ${baseSha.slice(0, 7)}.` });
        } catch (err) {
          return failed(`Could not start the package branch: ${(err as Error).message}`);
        }
      }
      const outcome = await this.runPackage(pkgBrief, pkg);
      if (!outcome.ok) return failed(outcome.summary);
      lastEval = outcome.ev;
      if (this.publishing && this.branch) {
        const published = await this.publishPackage(pkg, outcome.ev);
        if (!published.ok) return failed(published.summary);
      }
    }
    this.pkg = undefined;

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

  /** One work package: contract, then build/evaluate rounds. Returns the last evaluation on success. */
  private async runPackage(pkgBrief: Record<string, string>, pkg: WorkPackage): Promise<{ ok: true; ev: Evaluation | null } | { ok: false; summary: string }> {
    const ws = this.config.workspace;
    const label = this.pkg ? ` ${this.pkg.id}` : "";
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
        }).run(firstMessage("contract", this.config, { ...this.projectContext(), ...pkgBrief, Instructions: `Read the spec and feature list, inspect the codebase, then call propose_contract${this.pkg ? " for this work package only" : ""}.` }));
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
          }).run(firstMessage("contract review", this.config, { ...this.projectContext(), ...pkgBrief, "Proposed contract": renderContract(proposed), Instructions: "Review and call review_contract with the final criteria." }));
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
      if (stop) return { ok: false, summary: "Stopped at the contract stage." };
    } else {
      this.contract = [{ id: "C1", text: "The task as described is complete and verified by running the result", verify: "Run the program / tests and inspect", hard: true }];
      writeWorkspaceFile(ws, ".reins/contract.json", JSON.stringify(this.contract, null, 2));
    }

    // ---- Tests (written before the build) ----
    this.testPlan = null;
    if (this.config.components.testsFirst) {
      const stop = await this.phase("tests", 0, async () => {
        const state: { plan: TestPlan | null; red: { exitCode: number | null; excerpt: string } | null } = { plan: null, red: null };
        const r = await this.loop("evaluator", "test_writer", [...READ_TOOLS, "write_file", "edit_file", "bash"], ["propose_tests"], {
          propose_tests: async (input: any) => {
            const v = validateTestPlan(input, this.contract, (f) => fs.existsSync(path.join(ws, f)));
            if (v.problems.length) throw new Error(`Refused: ${v.problems.join(" ")} Fix these and call propose_tests again.`);
            // Red check: the suite must fail before any code is written, or it does not test the new behaviour.
            const run = await runShell(v.plan.command, ws, this.control.signal, 180_000, undefined, this.config.components.osSandbox ? { workspace: ws, allowNetwork: this.config.guardrail.allowNetwork } : undefined);
            const excerpt = run.out.trim().slice(-1500);
            if (run.timedOut) throw new Error(`Refused: the test command timed out after 180 seconds (${v.plan.command}). Make the suite fast and non-interactive, then call propose_tests again.`);
            if (run.code === 0) throw new Error(`Refused: the suite passes before any code is written (${v.plan.command} exited 0), so it does not test the new behaviour. Make each test fail because the behaviour is missing, then call propose_tests again.${excerpt ? `\nOutput:\n${excerpt}` : ""}`);
            state.plan = v.plan;
            state.red = { exitCode: run.code, excerpt };
            writeWorkspaceFile(ws, ".reins/tests.json", JSON.stringify(v.plan, null, 2));
            writeWorkspaceFile(ws, ".reins/tests.md", renderTestPlanDoc(v.plan, state.red));
            this.bus.emitEvent({ type: "tests.agreed", plan: v.plan, red: state.red });
            return `Agreed: ${v.plan.tests.length} test${v.plan.tests.length === 1 ? "" : "s"}, red before the build (exit ${run.code}).`;
          },
        }).run(
          firstMessage("tests", this.config, {
            ...this.projectContext(),
            ...pkgBrief,
            Contract: renderContract(this.contract),
            Instructions: "Learn how this project tests, write the tests that prove every hard criterion (they must fail before any code is written), run them to see the failure, then call propose_tests.",
          }),
        );
        if (this.checkStop(r)) return { result: r, summary: "Stopped.", value: true };
        if (state.plan && state.red) {
          this.testPlan = state.plan;
          this.contract = [...this.contract.filter((c) => c.id !== testsCriterion("").id), testsCriterion(state.plan.command)];
          writeWorkspaceFile(ws, ".reins/contract.json", JSON.stringify(this.contract, null, 2));
          this.bus.emitEvent({ type: "contract.agreed", criteria: this.contract });
          return { result: r, summary: `${state.plan.tests.length} tests written, red before the build (exit ${state.red.exitCode}); T added to the contract.`, value: false };
        }
        this.bus.emitEvent({ type: "note", level: "warn", text: `The test writer did not call propose_tests (${r.reason}); the build goes ahead without tests to make pass and the contract is unchanged. ${TURNS_ADVICE}` });
        return { result: r, summary: "No tests proposed.", value: false };
      });
      if (stop) return { ok: false, summary: "Stopped while writing tests." };
      if (this.testPlan && this.config.components.gitCommits) await this.commit(`reins: tests${label} — ${this.pkg ? pkg.title : this.config.title}`);
    }

    // ---- Build / Evaluate rounds ----
    let lastEval: Evaluation | null = null;
    for (let round = 1; round <= this.config.maxFixRounds + 1; round++) {
      await this.runInitScript();
      const stop = await this.phase("build", round, async () => {
        const ctx = this.projectContext();
        const extra: Record<string, string> = { ...(this.builderHistory ? { "Budget and time": ctx["Budget and time"] } : { ...ctx, ...pkgBrief }), Contract: renderContract(this.contract) };
        if (this.testPlan && !lastEval) extra["Tests to make pass"] = renderTestsForBuilder(this.testPlan);
        if (lastEval) extra["Evaluation of the previous round"] = renderEvaluationForBuilder(lastEval);
        else extra.Instructions = `Follow the session preamble, then implement the features${this.pkg ? ` of this package (${pkg.features.join(", ")}). Build only the features of this package; the others belong to later packages` : ""}. Call finish only when every hard criterion's verification step has been run and passed.`;
        if (this.config.components.selfVerification) extra["Self-verification"] = "Before finish, run each criterion's verify step yourself and include the observed result in your summary.";
        const loop = this.loop("builder", "builder", [...READ_TOOLS, ...WRITE_TOOLS], ["finish"], {}, this.shouldResetBuilder() ? undefined : this.builderHistory);
        const r = await loop.run(firstMessage(lastEval ? `build (fix round ${round - 1})` : "build", this.config, extra));
        this.builderHistory = this.config.engine === "claude-code" ? (r.messages.length ? r.messages : [{ role: "user", content: "(claude-code session)" }]) : r.messages;
        return { result: r, summary: r.terminalInput?.summary ?? r.finalText.slice(0, 300), value: this.checkStop(r) };
      });
      if (stop) return { ok: false, summary: "Stopped while building." };

      if (this.config.components.gitCommits) await this.commit(`reins: ${lastEval ? `fix round ${round - 1}` : "build"}${label} — ${this.pkg ? pkg.title : this.config.title}`);

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
            ...pkgBrief,
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
      if (result.stop || !result.ev) return { ok: false, summary: "Stopped while evaluating." };
      lastEval = result.ev;
      if (this.config.pauses.afterEvaluation) {
        const a = await this.control.requestPhaseApproval("Evaluation complete", `Verdict: ${lastEval.verdict}. Continue?`, lastEval);
        if (!a.approved) return { ok: false, summary: "Stopped after evaluation." };
      }
      if (lastEval.verdict === "pass") break;
      if (round === this.config.maxFixRounds + 1) {
        // A forced report says what the evaluator verified; the synthesised summary already says why there was no report.
        const why = lastEval.origin === "forced" ? `the evaluator ran out of turns (${this.config.maxTurnsPerPhase}) before reporting on its own; ${lastEval.verified} of ${this.contract.length} criteria were verified. ${TURNS_ADVICE} ` : "";
        return { ok: false, summary: `Evaluation still failing after ${this.config.maxFixRounds} fix rounds: ${why}${lastEval.summary}` };
      }
    }
    return { ok: true, ev: lastEval };
  }


  /** Push the package branch, open its pull request, wait until it can be merged, merge it and pull the base. */
  private async publishPackage(pkg: WorkPackage, ev: Evaluation | null): Promise<{ ok: true } | { ok: false; summary: string }> {
    const ws = this.config.workspace;
    const pub = this.publishing!;
    const branch = this.branch!;
    const policy = this.publishPolicy;
    const signal = this.control.signal;
    type Outcome = { ok: true } | { ok: false; summary: string };
    return this.phase<Outcome>("publish", 0, async () => {
      // Review rounds spend model turns inside this phase; their usage is summed here.
      let usage = emptyUsage();
      let cost = 0;
      const result = () => ({ usage, costUsd: cost }) as unknown as LoopResult;
      const fail = (summary: string) => ({ result: result(), summary, value: { ok: false, summary } as Outcome });
      const since0 = new Date().toISOString();
      let since = since0;
      let rounds = 0;
      let pr: { number: number; url: string };
      try {
        await this.publisher.push(ws, pub.remote, branch.name, signal);
        const body = renderPrBody({ pkg, features: this.features, contract: this.contract, evaluation: ev, testsDoc: readWorkspaceFile(ws, ".reins/tests.md") ?? "", baseSha: branch.baseSha, base: pub.base, runId: this.config.id || "run" });
        pr = await this.publisher.open(ws, { base: pub.base, head: branch.name, title: pkg.title, body }, signal);
      } catch (err) {
        return fail(`Could not open the pull request: ${(err as Error).message}`);
      }
      const where = `Pull request #${pr.number} (${pr.url})`;
      this.bus.emitEvent({ type: "pr.opened", number: pr.number, url: pr.url, branch: branch.name, base: pub.base, ...(this.pkg ? { package: this.pkg } : {}) });
      if (policy.mergeWhen === "never") {
        // The next package stacks on this branch; a person merges the pull requests in order.
        pub.base = branch.name;
        return { result: result(), summary: `${where} opened; not waiting for a merge, the next package stacks on ${branch.name}.`, value: { ok: true } as Outcome };
      }
      const deadline = Date.now() + policy.maxWaitMinutes * 60_000;
      for (;;) {
        if (signal.aborted) return fail(`Stopped while waiting on ${where}.`);
        let st;
        let feedback;
        try {
          const view = await this.publisher.view(ws, pr.number, signal);
          st = prState(view, policy.mergeWhen);
          feedback = st.kind === "merged" || st.kind === "closed" ? [] : collectFeedback(view, await this.publisher.inlineComments(ws, pr.number, signal), since);
        } catch (err) {
          return fail(`Could not read ${where}: ${(err as Error).message}`);
        }
        if (st.kind === "merged") break;
        if (st.kind === "closed") return fail(`${where} was closed without being merged.`);
        if (st.kind === "failing" || feedback.length) {
          // Review comments and failing checks are work for the builder, up to maxReviewRounds per pull request.
          const failing = st.kind === "failing" ? st.checks : [];
          if (rounds >= policy.maxReviewRounds) {
            const what = [failing.length ? `failing checks (${failing.join(", ")})` : "", feedback.length ? `${feedback.length} unaddressed comment${feedback.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
            return fail(`${where} still has ${what} after ${rounds} review round${rounds === 1 ? "" : "s"}. It stays open.`);
          }
          rounds++;
          const checks = failing.length ? (await this.publisher.checks(ws, pr.number, signal)).filter((c) => c.bucket === "fail" || c.bucket === "cancel") : [];
          const rows = checks.length ? checks : failing.map((name) => ({ name, bucket: "fail" }));
          since = new Date().toISOString();
          const ctx = this.projectContext();
          const extra: Record<string, string> = {
            ...ctx,
            ...(this.pkg ? { "Work package": `${packageLabel(this.pkg)}\n${renderPackage(pkg, this.features)}` } : {}),
            Contract: renderContract(this.contract),
            ...(this.testPlan ? { "Tests to keep passing": `Run: ${this.testPlan.command}` } : {}),
            "Review feedback": renderFeedbackForBuilder(feedback, rows, pr.url),
          };
          const r = await this.loop("builder", "builder", [...READ_TOOLS, ...WRITE_TOOLS], ["finish"], {}).run(firstMessage(`publish (review round ${rounds})`, this.config, extra));
          usage = addUsage(usage, r.usage);
          cost += r.costUsd;
          if (this.checkStop(r)) return fail(`Stopped during review round ${rounds} on ${where}.`);
          const summary = String(r.terminalInput?.summary ?? r.finalText.slice(0, 1000)).trim() || `Review round ${rounds} finished without a summary.`;
          if (this.config.components.gitCommits) await this.commit(`reins: review round ${rounds}${this.pkg ? ` ${this.pkg.id}` : ""} — ${this.pkg ? pkg.title : this.config.title}`);
          try {
            await this.publisher.push(ws, pub.remote, branch.name, signal);
            await this.publisher.comment(ws, pr.number, `Reins review round ${rounds}: ${summary}`, signal);
          } catch (err) {
            return fail(`Could not push review round ${rounds} to ${where}: ${(err as Error).message}`);
          }
          this.bus.emitEvent({ type: "pr.feedback", number: pr.number, url: pr.url, round: rounds, comments: feedback.length, checks: failing, summary });
          await this.emitChangedFiles();
          continue;
        }
        if (st.kind === "ready") {
          if (this.config.pauses.beforeMerge) {
            const a = await this.control.requestPhaseApproval(`Merge pull request #${pr.number}?`, `${pkg.title} is approved with green checks. Merge it (${policy.mergeMethod}) into ${pub.base}?`, { number: pr.number, url: pr.url, branch: branch.name, base: pub.base, method: policy.mergeMethod });
            if (!a.approved) return fail(`Merge of ${where.charAt(0).toLowerCase() + where.slice(1)} rejected${a.note ? `: ${a.note}` : ""}. It stays open.`);
          }
          try {
            await this.publisher.merge(ws, pr.number, policy.mergeMethod, signal);
          } catch (err) {
            return fail(`Could not merge ${where}: ${(err as Error).message}`);
          }
          break;
        }
        if (Date.now() >= deadline) return fail(`${where} was not merged after ${policy.maxWaitMinutes} minutes (${st.why}). It stays open; merge it and start the next package with a new run.`);
        await this.sleep(policy.pollSeconds * 1000, signal);
      }
      let sha: string;
      try {
        sha = await this.publisher.afterMerge(ws, pub.remote, pub.base, branch.name, signal);
      } catch (err) {
        return fail(`${where} is merged, but the base could not be pulled: ${(err as Error).message}`);
      }
      this.bus.emitEvent({ type: "pr.merged", number: pr.number, url: pr.url, branch: branch.name, base: pub.base, sha });
      this.branch = null;
      return { result: result(), summary: `${where} merged (${policy.mergeMethod}) into ${pub.base} at ${sha.slice(0, 7)}${rounds ? ` after ${rounds} review round${rounds === 1 ? "" : "s"}` : ""}.`, value: { ok: true } as Outcome };
    });
  }

  /** A hard criterion that was not observed to pass (failed or unverified) fails the sprint. */
  private verdictFor(results: CriterionResult[]): "pass" | "fail" {
    return this.contract.some((c) => c.hard && results.find((r) => r.id === c.id)?.pass !== true) ? "fail" : "pass";
  }

  /** `.reins/init.sh` is a harness-known artifact: run before every build phase so the builder starts from a known-good state. */
  private async runInitScript() {
    const ws = this.config.workspace;
    if (!readWorkspaceFile(ws, ".reins/init.sh")) return;
    const r = await runShell("/bin/zsh .reins/init.sh 2>&1 | tail -40", ws, this.control.signal, 180_000, undefined, this.config.components.osSandbox ? { workspace: ws, allowNetwork: this.config.guardrail.allowNetwork } : undefined);
    this.bus.emitEvent({ type: "note", level: r.code === 0 && !r.timedOut ? "info" : "warn", text: `init.sh ${r.timedOut ? "timed out" : r.code === 0 ? "succeeded" : `exited ${r.code}`}${r.out.trim() ? `:\n${r.out.trim().slice(0, 1500)}` : ""}` });
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
