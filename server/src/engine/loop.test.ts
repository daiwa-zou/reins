import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { AgentLoop, type LoopControl } from "./loop.js";
import { Orchestrator } from "./orchestrator.js";
import { TURNS_REMAINING_NUDGE_AT } from "./turnBudget.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";

/**
 * A scripted stand-in for the Messages API. Each call pops the next scripted
 * response; `fn` responses can look at the request (to assert on tools,
 * betas, context management) and raise typed-looking errors.
 */
type Scripted = Partial<Anthropic.Beta.BetaMessage> | ((params: any) => Partial<Anthropic.Beta.BetaMessage>);
function fakeClient(script: Scripted[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: any) => {
          calls.push(params);
          const next = script.shift();
          if (!next) throw new Error("script exhausted");
          const body = typeof next === "function" ? next(params) : next;
          const msg: Anthropic.Beta.BetaMessage = {
            id: "msg",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } as any,
            ...body,
          } as any;
          return { finalMessage: async () => msg };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const toolUse = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input }) as any;
const text = (t: string) => ({ type: "text", text: t }) as any;

function control(overrides: Partial<LoopControl> = {}): LoopControl {
  return {
    signal: new AbortController().signal,
    waitIfPaused: async () => {},
    requestApproval: async () => ({ approved: true }),
    drainSteer: () => [],
    remainingBudget: () => 100,
    ...overrides,
  };
}

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reins-loop-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# Sample\n");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "echo ok" } }));
  execSync("git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init", { cwd: dir });
  return dir;
}

function collect(bus: RunBus) {
  const events: RunEvent[] = [];
  bus.on("event", (e: RunEvent) => events.push(e));
  return events;
}

describe("AgentLoop", () => {
  it("executes tools, feeds results back and ends on a terminal tool", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false } as any });
    const { client, calls } = fakeClient([
      { content: [text("Let me look."), toolUse("t1", "read_file", { path: "README.md" }), toolUse("t2", "list_files", { pattern: "*.json" })], stop_reason: "tool_use" },
      (params) => {
        const last = params.messages[params.messages.length - 1];
        expect(last.role).toBe("user");
        expect(last.content.map((b: any) => b.tool_use_id)).toEqual(["t1", "t2"]);
        expect(last.content[0].content).toContain("# Sample");
        return { content: [toolUse("t3", "finish", { summary: "done", open_items: [] })], stop_reason: "tool_use" };
      },
    ]);
    const bus = new RunBus("test", false);
    const events = collect(bus);
    const loop = new AgentLoop(client, cfg, bus, control(), { role: "planner", system: "sys", tools: ["read_file", "list_files", "finish"], terminal: ["finish"], handlers: {}, maxTurns: 10 });
    const r = await loop.run("go");
    expect(r.reason).toBe("terminal");
    expect(r.terminalInput.summary).toBe("done");
    expect(r.turns).toBe(2);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "tool.called")).toHaveLength(3);
    expect(events.filter((e) => e.type === "context.snapshot")).toHaveLength(2);
    // request shape: cached system prefix, adaptive thinking, betas for compaction + context editing
    expect(calls[0].system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(calls[0].betas).toContain("compact-2026-01-12");
    expect(calls[0].context_management.edits.map((e: any) => e.type)).toEqual(["clear_tool_uses_20250919", "compact_20260112"]);
    expect(calls[0].output_config.task_budget.type).toBe("tokens");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("gates risky shell commands through approval and records the decision", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false, actionClassifier: false } as any });
    const asked: string[] = [];
    const { client } = fakeClient([
      { content: [toolUse("t1", "bash", { command: "git push origin main" })], stop_reason: "tool_use" },
      (params) => {
        const res = params.messages[params.messages.length - 1].content[0];
        expect(res.is_error).toBe(true);
        expect(res.content).toContain("declined");
        return { content: [toolUse("t2", "bash", { command: "sudo rm -rf /" })], stop_reason: "tool_use" };
      },
      (params) => {
        const res = params.messages[params.messages.length - 1].content[0];
        expect(res.content).toContain("Denied by guardrails");
        return { content: [toolUse("t3", "finish", { summary: "ok", open_items: [] })], stop_reason: "tool_use" };
      },
    ]);
    const bus = new RunBus("test", false);
    const events = collect(bus);
    const loop = new AgentLoop(client, cfg, bus, control({ requestApproval: async (_k, title) => (asked.push(title), { approved: false, note: "not today" }) }), {
      role: "builder",
      system: "sys",
      tools: ["bash", "finish"],
      terminal: ["finish"],
      handlers: {},
      maxTurns: 10, // above the turns-remaining nudge threshold, so the last message is always the tool result
    });
    const r = await loop.run("go");
    expect(r.reason).toBe("terminal");
    expect(asked).toHaveLength(1);
    const decisions = events.filter((e): e is Extract<RunEvent, { type: "guardrail.decision" }> => e.type === "guardrail.decision");
    // Every gate decision is logged, including the allow for the in-workspace finish tool.
    expect(decisions.map((d) => d.verdict)).toEqual(["ask", "deny", "deny", "allow"]);
    expect(decisions[1].source).toBe("user");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("drops a rejected beta and retries instead of failing the run", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false } as any });
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { client, calls } = fakeClient([
      () => {
        throw new Anthropic.BadRequestError(400, { error: { message: "compact_20260112 is not supported" } }, "compact_20260112 is not supported", new Headers());
      },
      (params) => {
        expect(params.betas).not.toContain("compact-2026-01-12");
        return { content: [text("fine")], stop_reason: "end_turn" };
      },
    ]);
    const bus = new RunBus("test", false);
    const events = collect(bus);
    const loop = new AgentLoop(client, cfg, bus, control(), { role: "planner", system: "sys", tools: ["read_file"], terminal: [], handlers: {}, maxTurns: 3 });
    const r = await loop.run("go");
    expect(r.reason).toBe("end_turn");
    expect(calls).toHaveLength(2);
    expect(events.some((e) => e.type === "note" && e.text.includes("compaction"))).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("delivers operator notes as mid-conversation system messages", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false } as any });
    const notes = ["keep it short"];
    const { client, calls } = fakeClient([{ content: [text("ok")], stop_reason: "end_turn" }]);
    const bus = new RunBus("test", false);
    const loop = new AgentLoop(client, cfg, bus, control({ drainSteer: () => notes.splice(0) }), { role: "builder", system: "sys", tools: [], terminal: [], handlers: {}, maxTurns: 2 });
    await loop.run("go");
    const sys = calls[0].messages.find((m: any) => m.role === "system");
    expect(sys.content).toContain("keep it short");
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("AgentLoop turn budget", () => {
  const evaluatorOpts = { role: "evaluator" as const, system: "sys", tools: ["bash", "report_evaluation"], terminal: ["report_evaluation"], handlers: {} };
  const bashTurn = (i: number) => ({ content: [toolUse(`b${i}`, "bash", { command: "echo checking" })], stop_reason: "tool_use" }) as Scripted;
  const report = (id: string, results: any[], summary: string) => ({ content: [toolUse(id, "report_evaluation", { results, summary })], stop_reason: "tool_use" }) as Scripted;
  const systemNotes = (params: any): string[] => params.messages.filter((m: any) => m.role === "system").map((m: any) => String(m.content));
  const warnNotes = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "note" }> => e.type === "note" && e.level === "warn").map((e) => e.text);

  it("tells a role with a terminal tool how many turns remain, on every turn once the threshold is reached", async () => {
    expect(TURNS_REMAINING_NUDGE_AT).toBe(5);
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false, actionClassifier: false } as any });
    const seen: string[][] = [];
    const { client } = fakeClient([
      (p) => (seen.push(systemNotes(p)), bashTurn(1) as any),
      (p) => (seen.push(systemNotes(p)), bashTurn(2) as any),
      (p) => (seen.push(systemNotes(p)), bashTurn(3) as any),
      // Turn 4 of 7: nudged again, and the scripted evaluator obeys.
      (p) => (seen.push(systemNotes(p)), report("e1", [{ id: "C1", pass: true, evidence: "seen" }], "nudged report") as any),
    ]);
    const bus = new RunBus("test-nudge", false);
    const events = collect(bus);
    const r = await new AgentLoop(client, cfg, bus, control(), { ...evaluatorOpts, maxTurns: 7 }).run("check C1");
    expect(r.reason).toBe("terminal");
    expect(r.forced).toBeUndefined();
    expect(r.terminalInput.summary).toBe("nudged report");
    // Turns 1 and 2 (7 and 6 remaining) get nothing; turn 3 (5 remaining) and turn 4 (4 remaining) each get an operator message.
    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual([]);
    expect(seen[2]).toHaveLength(1);
    expect(seen[2][0]).toMatch(/5 turns left.*report_evaluation now.*unverified/s);
    expect(seen[3]).toHaveLength(2);
    expect(seen[3][1]).toMatch(/4 turns left/);
    expect(warnNotes(events).filter((t) => /turns? left/.test(t))).toEqual([expect.stringMatching(/evaluator has 5 turns left.*report_evaluation/), expect.stringMatching(/evaluator has 4 turns left/)]);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("makes one forced call at the cap that offers only the terminal tool, and marks the result forced", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false, actionClassifier: false } as any });
    const { client, calls } = fakeClient([
      bashTurn(1),
      bashTurn(2),
      bashTurn(3),
      (p) => {
        expect(p.tools.map((t: any) => t.name)).toEqual(["report_evaluation"]);
        expect(p.tool_choice).toEqual({ type: "any" });
        expect(p.thinking).toBeUndefined();
        const last = p.messages[p.messages.length - 1];
        expect(last.role).toBe("user");
        expect(last.content).toMatch(/Turn budget exhausted.*3-turn cap.*report_evaluation now/s);
        return report("e1", [{ id: "C1", pass: true, evidence: "seen" }, { id: "C2", pass: false, unverified: true, evidence: "not reached" }], "forced report") as any;
      },
    ]);
    const bus = new RunBus("test-forced", false);
    const events = collect(bus);
    const r = await new AgentLoop(client, cfg, bus, control(), { ...evaluatorOpts, maxTurns: 3 }).run("check C1 and C2");
    expect(calls).toHaveLength(4);
    expect(r.reason).toBe("terminal");
    expect(r.forced).toBe(true);
    expect(r.turns).toBe(4);
    expect(r.terminalInput.results).toHaveLength(2);
    expect(r.costUsd).toBeGreaterThan(0);
    const notes = warnNotes(events);
    // Nudged on every one of the three turns (3, 2 and 1 remaining), then the forced call.
    expect(notes.filter((t) => /turns? left/.test(t))).toHaveLength(3);
    expect(systemNotes(calls[2])[2]).toMatch(/last turn/);
    expect(notes.some((t) => /reached the 3-turn cap without calling report_evaluation.*only that tool/.test(t))).toBe(true);
    expect(events.filter((e) => e.type === "turn.started")).toHaveLength(4);
    expect(events.some((e) => e.type === "tool.called" && e.name === "report_evaluation")).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("returns max_turns with the last text when even the forced call does not report", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false, actionClassifier: false } as any });
    const { client, calls } = fakeClient([bashTurn(1), bashTurn(2), { content: [text("I was still checking C1 when the budget ran out.")], stop_reason: "end_turn" }]);
    const r = await new AgentLoop(client, cfg, new RunBus("test-noreport", false), control(), { ...evaluatorOpts, maxTurns: 2 }).run("check");
    expect(calls).toHaveLength(3);
    expect(r.reason).toBe("max_turns");
    expect(r.terminalTool).toBeUndefined();
    expect(r.finalText).toBe("I was still checking C1 when the budget ran out.");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("forces the terminal tool after two plain-text endings as well", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "t", workspace: ws, components: { osSandbox: false, actionClassifier: false } as any });
    const { client, calls } = fakeClient([
      { content: [text("All fine.")], stop_reason: "end_turn" },
      { content: [text("Really, all fine.")], stop_reason: "end_turn" },
      { content: [text("Done.")], stop_reason: "end_turn" },
      (p) => {
        expect(p.tool_choice).toEqual({ type: "any" });
        return report("e1", [{ id: "C1", pass: true, evidence: "fine" }], "forced after text") as any;
      },
    ]);
    const r = await new AgentLoop(client, cfg, new RunBus("test-endturn", false), control(), { ...evaluatorOpts, maxTurns: 10 }).run("check");
    expect(calls).toHaveLength(4);
    expect(calls[2].messages.filter((m: any) => typeof m.content === "string" && m.content.startsWith("Please finish"))).toHaveLength(2);
    expect(r.reason).toBe("terminal");
    expect(r.forced).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("Orchestrator", () => {
  it("synthesises an evaluation when the evaluator never reports, briefs the fix round with it, and says why the run failed", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({
      task: "Add a greeting file",
      workspace: ws,
      maxTurnsPerPhase: 5,
      maxFixRounds: 1,
      components: { planner: false, osSandbox: false, actionClassifier: false } as any,
      pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false },
    });
    const criteria = [
      { id: "C1", text: "hello.txt contains hello", verify: "cat hello.txt", hard: true },
      { id: "C2", text: "README mentions hello", verify: "grep hello README.md", hard: true },
    ];
    const bash = (id: string) => ({ content: [toolUse(id, "bash", { command: "echo checking" })], stop_reason: "tool_use" }) as Scripted;
    let fixBrief = "";
    const { client, calls } = fakeClient([
      // contract: builder proposes, evaluator reviews
      { content: [toolUse("c1", "propose_contract", { criteria, rationale: "r" })], stop_reason: "tool_use" },
      { content: [toolUse("c2", "review_contract", { accept: true, criteria, feedback: "fine" })], stop_reason: "tool_use" },
      // build
      { content: [toolUse("b1", "write_file", { path: "hello.txt", content: "hello\n" }), toolUse("b2", "finish", { summary: "built", open_items: [] })], stop_reason: "tool_use" },
      // evaluate round 1: five turns of checking, nudged on every one, then the forced call answers with text only
      ...[1, 2, 3, 4, 5].map((i) => bash(`e${i}`)),
      { content: [text("I had started the server and was about to curl it.")], stop_reason: "end_turn" },
      // fix round: the brief must carry the synthesised report
      (params) => {
        fixBrief = String(params.messages.filter((m: any) => m.role === "user").pop().content);
        return { content: [toolUse("b3", "finish", { summary: "re-verified", open_items: [] })], stop_reason: "tool_use" };
      },
      // evaluate round 2: out of turns again, but the forced call reports: C1 verified, C2 not reached
      ...[1, 2, 3, 4, 5].map((i) => bash(`f${i}`)),
      { content: [toolUse("f6", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "cat shows hello" }, { id: "C2", pass: false, unverified: true, evidence: "out of turns" }], summary: "C1 holds; C2 not reached." })], stop_reason: "tool_use" },
    ]);
    const bus = new RunBus("test-synth", false);
    const events = collect(bus);
    const orch = new Orchestrator(client, cfg, bus, { ...control(), requestPhaseApproval: async () => ({ approved: true }), requestContractApproval: async (c) => ({ approved: true, criteria: c }) });
    const r = await orch.run();
    expect(calls).toHaveLength(16);
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Evaluation still failing after 1 fix rounds: the evaluator ran out of turns (5) before reporting on its own; 1 of 2 criteria were verified. Raise maxTurnsPerPhase for the evaluate phase or reduce the number of contract criteria. C1 holds; C2 not reached.");

    const evals = events.filter((e): e is Extract<RunEvent, { type: "evaluation.result" }> => e.type === "evaluation.result");
    expect(evals.map((e) => e.origin)).toEqual(["synthesised", "forced"]);
    expect(evals[0].verdict).toBe("fail");
    expect(evals[0].results).toEqual([
      { id: "C1", pass: false, unverified: true, evidence: expect.stringMatching(/ran out of turns \(5\)/) },
      { id: "C2", pass: false, unverified: true, evidence: expect.stringMatching(/ran out of turns \(5\)/) },
    ]);
    expect(evals[0].summary).toMatch(/^No evaluation report: the evaluator ran out of turns \(5\) before reporting; 0 of 2 criteria were verified\. Raise maxTurnsPerPhase/);
    expect(evals[0].summary).toContain("The evaluator's last words: I had started the server");
    expect(evals[1].results.map((x) => [x.id, x.pass, x.unverified ?? false])).toEqual([
      ["C1", true, false],
      ["C2", false, true],
    ]);

    // The fix round is never empty: it names every unverified criterion and says what to do about it.
    expect(fixBrief).toContain("# Evaluation of the previous round");
    expect(fixBrief).toContain("synthesised by the harness");
    expect(fixBrief).toContain("- C1 UNVERIFIED:");
    expect(fixBrief).toContain("- C2 UNVERIFIED:");
    expect(fixBrief).toMatch(/run the verification step of every failed or unverified criterion yourself/);

    const notes = events.filter((e): e is Extract<RunEvent, { type: "note" }> => e.type === "note" && e.level === "warn").map((e) => e.text);
    expect(notes.some((t) => /evaluator has 5 turns left/.test(t))).toBe(true);
    expect(notes.some((t) => /reached the 5-turn cap without calling report_evaluation/.test(t))).toBe(true);
    expect(notes.some((t) => /did not call report_evaluation even in the forced final call; a report was synthesised/.test(t))).toBe(true);
    expect(notes.some((t) => /reported only in the forced final call: 1 of 2 criteria verified/.test(t))).toBe(true);
    const phases = events.filter((e): e is Extract<RunEvent, { type: "phase.finished" }> => e.type === "phase.finished");
    expect(phases.find((p) => p.phase === "evaluate" && p.round === 1)?.summary).toMatch(/^FAIL \(synthesised report\): No evaluation report/);
    expect(phases.find((p) => p.phase === "evaluate" && p.round === 2)?.summary).toMatch(/^FAIL \(forced report\): C1 holds/);
    const md = fs.readFileSync(path.join(ws, ".reins/evaluation.md"), "utf8");
    expect(md).toContain("# Evaluation round 2 (forced report)");
    expect(md).toContain("- C2: UNVERIFIED — out of turns");
    fs.rmSync(ws, { recursive: true, force: true });
  });


  it("runs plan -> contract -> build -> evaluate -> wrapup with file handoff and commits", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({ task: "Add a greeting file", workspace: ws, components: { osSandbox: false, actionClassifier: false } as any, pauses: { afterPlan: false, afterContract: true, beforeCommit: false, afterEvaluation: false } });
    const features = [{ id: "F1", title: "hello.txt exists", status: "todo" }];
    const criteria = [{ id: "C1", text: "hello.txt contains hello", verify: "cat hello.txt", hard: true }];
    const { client } = fakeClient([
      // planner
      (params) => {
        const names = params.tools.map((t: any) => t.name);
        expect(names).toContain("finish");
        expect(names).toContain("update_progress");
        expect(names).not.toContain("bash");
        return { content: [toolUse("p1", "write_file", { path: ".reins/spec.md", content: "# spec" }), toolUse("p2", "update_progress", { features, note: "planned" })], stop_reason: "tool_use" };
      },
      { content: [toolUse("p3", "finish", { summary: "planned", open_items: [] })], stop_reason: "tool_use" },
      // contract: builder proposes, evaluator reviews
      (params) => {
        expect(params.tools.map((t: any) => t.name)).toContain("propose_contract");
        return { content: [toolUse("c1", "propose_contract", { criteria, rationale: "r" })], stop_reason: "tool_use" };
      },
      (params) => {
        expect(params.tools.map((t: any) => t.name)).toContain("review_contract");
        return { content: [toolUse("c2", "review_contract", { accept: true, criteria, feedback: "fine" })], stop_reason: "tool_use" };
      },
      // build
      { content: [toolUse("b1", "write_file", { path: "hello.txt", content: "hello\n" }), toolUse("b2", "update_progress", { features: [{ ...features[0], status: "done" }], note: "built" })], stop_reason: "tool_use" },
      { content: [toolUse("b3", "finish", { summary: "built", open_items: [] })], stop_reason: "tool_use" },
      // evaluate
      (params) => {
        expect(params.messages[0].content).toContain("hello.txt contains hello");
        return { content: [toolUse("e1", "bash", { command: "cat hello.txt" })], stop_reason: "tool_use" };
      },
      (params) => {
        expect(params.messages[params.messages.length - 1].content[0].content).toContain("hello");
        return { content: [toolUse("e2", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "cat shows hello" }], summary: "all good" })], stop_reason: "tool_use" };
      },
    ]);
    const bus = new RunBus("test", false);
    const events = collect(bus);
    const approvals: string[] = [];
    const orch = new Orchestrator(client, cfg, bus, {
      ...control(),
      requestPhaseApproval: async () => ({ approved: true }),
      requestContractApproval: async (c) => (approvals.push("contract"), { approved: true, criteria: c }),
    });
    const r = await orch.run();
    expect(r.ok).toBe(true);
    expect(approvals).toEqual(["contract"]);
    expect(events.filter((e) => e.type === "phase.started").map((e: any) => e.phase)).toEqual(["plan", "contract", "build", "evaluate", "wrapup"]);
    expect(fs.readFileSync(path.join(ws, ".reins/contract.json"), "utf8")).toContain("C1");
    expect(fs.readFileSync(path.join(ws, ".reins/progress.md"), "utf8")).toContain("built");
    expect(JSON.parse(fs.readFileSync(path.join(ws, ".reins/features.json"), "utf8"))[0].status).toBe("done");
    expect(events.some((e) => e.type === "git.commit")).toBe(true);
    expect(execSync("git log --oneline", { cwd: ws, encoding: "utf8" })).toContain("reins: build");
    expect(execSync("git status --short", { cwd: ws, encoding: "utf8" }).trim()).toBe("");
    const evalEv = events.find((e): e is Extract<RunEvent, { type: "evaluation.result" }> => e.type === "evaluation.result")!;
    expect(evalEv.verdict).toBe("pass");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("emits each checkRunConfig warning as a warn note before the first phase, and still runs", async () => {
    const ws = tmpWorkspace();
    const cfg = defaultRunConfig({
      task: "t",
      workspace: ws,
      components: { planner: false, evaluator: false, osSandbox: false, actionClassifier: false } as any,
      pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: true },
      maxFixRounds: 0,
    });
    const { client } = fakeClient([
      // contract: builder proposes; no evaluator review
      { content: [toolUse("c1", "propose_contract", { criteria: [{ id: "C1", text: "x", verify: "y", hard: true }], rationale: "r" })], stop_reason: "tool_use" },
      // build
      { content: [toolUse("b1", "finish", { summary: "built", open_items: [] })], stop_reason: "tool_use" },
    ]);
    const bus = new RunBus("test-warn", false);
    const events = collect(bus);
    const orch = new Orchestrator(client, cfg, bus, { ...control(), requestPhaseApproval: async () => ({ approved: true }), requestContractApproval: async (c) => ({ approved: true, criteria: c }) });
    const r = await orch.run();
    expect(r.ok).toBe(true);
    const warnIdx = events.findIndex((e) => e.type === "note" && e.level === "warn" && e.text.includes("pauses.afterEvaluation"));
    const firstPhase = events.findIndex((e) => e.type === "phase.started");
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(firstPhase).toBeGreaterThan(warnIdx);
    expect((events[warnIdx] as any).text).toMatch(/evaluator/i);
    expect(events.filter((e) => e.type === "phase.started").map((e: any) => e.phase)).toEqual(["contract", "build", "wrapup"]);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
