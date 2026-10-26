import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ClaudeCodeLoop, workspaceRelative, zodShape } from "./claudeCodeLoop.js";
import { Orchestrator } from "./orchestrator.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";
import { ALL_TOOLS } from "../tools/registry.js";

// The turn-budget tests script the SDK's query() instead of spawning Claude Code;
// everything else in the SDK (the in-process MCP server, tool()) stays real.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return { ...actual, query: vi.fn(actual.query) };
});

// The claude-code engine maps Claude Agent SDK messages onto Reins' RunEvent
// log. These tests feed synthetic SDK messages through that mapping without
// spawning Claude Code, and check the Stage sees the same event shapes the
// anthropic engine emits.

function harness() {
  const config = defaultRunConfig({ task: "t", workspace: "/tmp/ws", engine: "claude-code" });
  const bus = new RunBus("test-run", false);
  const events: RunEvent[] = [];
  bus.on("event", (e: RunEvent) => events.push(e));
  const control = {
    signal: new AbortController().signal,
    waitIfPaused: async () => {},
    requestApproval: async () => ({ approved: true }),
    drainSteer: () => [],
    remainingBudget: () => 10,
  };
  const loop = new ClaudeCodeLoop(config, bus, control, { role: "builder", system: "sys", tools: ["read_file", "bash", "finish"], terminal: ["finish"], handlers: {}, maxTurns: 10 });
  let finalText = "";
  const feed = (msg: any) => (loop as any).handle(msg, (t: string) => (finalText = t));
  const pending = (loop as any).pending as Map<string, unknown>;
  return { events, feed, finalText: () => finalText, pending };
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };

describe("ClaudeCodeLoop event mapping", () => {
  it("turns an assistant message into turn, text, thinking and narrated tool.called events", () => {
    const h = harness();
    h.feed({ type: "system", subtype: "init", session_id: "s1", claude_code_version: "2.1.310", model: "claude-opus-5-5", apiKeySource: "none", tools: [], mcp_servers: [] });
    h.feed({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        model: "claude-opus-5-5",
        stop_reason: "tool_use",
        usage,
        content: [
          { type: "thinking", thinking: "Let me look around." },
          { type: "text", text: "Checking the tree." },
          { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    });
    // A turn closes when the next API response starts or the query ends.
    h.feed({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.01, num_turns: 1, result: "ok" });
    const types = h.events.map((e) => e.type);
    expect(types).toEqual(["note", "turn.started", "thinking", "text", "tool.called", "turn.finished", "context.snapshot"]);
    const called = h.events.find((e) => e.type === "tool.called") as Extract<RunEvent, { type: "tool.called" }>;
    expect(called.toolUseId).toBe("tu_1");
    expect(called.narration).toMatch(/ls -la/);
    const finished = h.events.find((e) => e.type === "turn.finished") as Extract<RunEvent, { type: "turn.finished" }>;
    expect(finished.usage).toEqual({ input: 100, output: 20, cacheRead: 1000, cacheWrite: 50 });
    const snap = h.events.find((e) => e.type === "context.snapshot") as Extract<RunEvent, { type: "context.snapshot" }>;
    expect(snap.snapshot.promptTokens).toBe(1150);
    expect(h.finalText()).toBe("Checking the tree.");
  });

  it("pairs tool results with the call by tool_use_id and reports errors", () => {
    const h = harness();
    h.feed({ type: "assistant", parent_tool_use_id: null, message: { model: "m", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "tu_2", name: "Read", input: { file_path: "/tmp/ws/a.txt" } }] } });
    h.feed({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_2", is_error: true, content: [{ type: "text", text: "No such file" }] }] } });
    const result = h.events.find((e) => e.type === "tool.result") as Extract<RunEvent, { type: "tool.result" }>;
    expect(result.toolUseId).toBe("tu_2");
    expect(result.name).toBe("Read");
    expect(result.ok).toBe(false);
    expect(result.output).toBe("No such file");
    expect(h.pending.size).toBe(0);
  });

  it("keeps subagent chatter and Reins MCP calls out of the tool feed", () => {
    const h = harness();
    h.feed({ type: "assistant", parent_tool_use_id: "parent", message: { model: "m", stop_reason: "end_turn", usage, content: [{ type: "text", text: "sub" }] } });
    h.feed({ type: "assistant", parent_tool_use_id: null, message: { model: "m", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "tu_3", name: "mcp__reins__finish", input: { summary: "done", open_items: [] } }] } });
    expect(h.events.filter((e) => e.type === "text")).toHaveLength(0);
    // The MCP server emits tool.called itself when the handler runs, so the assistant block must not double-report it.
    expect(h.events.filter((e) => e.type === "tool.called")).toHaveLength(0);
  });

  it("maps a compact boundary onto context.compacted", () => {
    const h = harness();
    h.feed({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 180_000, post_tokens: 20_000 } });
    const ev = h.events.find((e) => e.type === "context.compacted") as Extract<RunEvent, { type: "context.compacted" }>;
    expect(ev.role).toBe("builder");
    expect(ev.beforeTokens).toBe(180_000);
    expect(ev.afterTokens).toBe(20_000);
  });

  it("groups streamed blocks of one response into one turn, prices it from usage, and surfaces execution errors", () => {
    const h = harness();
    const base = { type: "assistant", parent_tool_use_id: null, session_id: "s1", uuid: "u" };
    // The SDK streams one message per content block; all share message.id and usage.
    h.feed({ ...base, message: { id: "msg_1", model: "claude-opus-5-5", usage, stop_reason: null, content: [{ type: "text", text: "a" }] } });
    h.feed({ ...base, message: { id: "msg_1", model: "claude-opus-5-5", usage, stop_reason: null, content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
    h.feed({ ...base, message: { id: "msg_2", model: "claude-opus-5-5", usage: { ...usage, output_tokens: 40 }, stop_reason: "end_turn", content: [{ type: "text", text: "b" }] } });
    h.feed({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.05, num_turns: 2, result: "ok" });
    const finished = h.events.filter((e): e is Extract<RunEvent, { type: "turn.finished" }> => e.type === "turn.finished");
    expect(finished).toHaveLength(2);
    expect(finished[0].usage.output).toBe(20);
    expect(finished[1].usage.output).toBe(40);
    expect(finished[0].costUsd).toBeGreaterThan(0);
    expect(h.events.filter((e) => e.type === "turn.started")).toHaveLength(2);
    expect(h.events.filter((e) => e.type === "context.snapshot")).toHaveLength(2);
    h.feed({ type: "result", subtype: "error_during_execution", is_error: true, total_cost_usd: 0.08, num_turns: 2, errors: ["boom"] });
    expect(h.events.some((e) => e.type === "error" && e.message.includes("error_during_execution"))).toBe(true);
    // max_turns is a normal stop for a phase, not an error.
    const before = h.events.filter((e) => e.type === "error").length;
    h.feed({ type: "result", subtype: "error_max_turns", is_error: true, total_cost_usd: 0.08, num_turns: 3 });
    expect(h.events.filter((e) => e.type === "error").length).toBe(before);
  });
});

// ---- Turn budget on the Claude Code engine ----

type QueryCall = { prompt: string; options: Options };
/** Each query() call runs the next script step, which yields SDK messages as the real subprocess would. */
function scriptQueries(steps: ((call: QueryCall) => AsyncGenerator<any>)[]): QueryCall[] {
  const calls: QueryCall[] = [];
  vi.mocked(query).mockImplementation((args: any) => {
    const call = { prompt: String(args.prompt), options: args.options as Options };
    const step = steps[calls.push(call) - 1];
    if (!step) throw new Error(`unscripted query #${calls.length}`);
    return Object.assign(step(call), { interrupt: async () => {} }) as any;
  });
  return calls;
}

/** A client on the Reins MCP server the loop handed to query(), so the script can call the structured tools the way the model would. */
async function reinsClient(options: Options): Promise<Client> {
  const server = (options.mcpServers as any).reins.instance;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "scripted-evaluator", version: "0" });
  await client.connect(clientSide);
  return client;
}

const usageCc = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };
const init = (session_id: string) => ({ type: "system", subtype: "init", session_id, claude_code_version: "x", model: "m", apiKeySource: "none", tools: [], mcp_servers: [] });
const assistant = (id: string, content: any[], stop_reason = "tool_use") => ({ type: "assistant", parent_tool_use_id: null, message: { id, model: "m", stop_reason, usage: usageCc, content } });
const bashTurn = (i: number) => [assistant(`m${i}`, [{ type: "tool_use", id: `t${i}`, name: "Bash", input: { command: "echo check" } }]), { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "ok" }] } }];
const result = (subtype: string) => ({ type: "result", subtype, is_error: subtype !== "success", total_cost_usd: 0.01, num_turns: 1, result: "" });
const hook = (options: Options, name: "PostToolBatch" | "Stop") => options.hooks![name]![0].hooks[0];
const warnNotes = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "note" }> => e.type === "note" && e.level === "warn").map((e) => e.text);

function ccHarness(maxTurns: number) {
  const config = defaultRunConfig({ task: "t", workspace: "/tmp/ws", engine: "claude-code" });
  const bus = new RunBus("test-cc", false);
  const events: RunEvent[] = [];
  bus.on("event", (e: RunEvent) => events.push(e));
  const control = { signal: new AbortController().signal, waitIfPaused: async () => {}, requestApproval: async () => ({ approved: true }), drainSteer: () => [], remainingBudget: () => 10 };
  const loop = new ClaudeCodeLoop(config, bus, control, { role: "evaluator", system: "sys", tools: ["read_file", "bash", "report_evaluation"], terminal: ["report_evaluation"], handlers: {}, maxTurns });
  return { loop, events };
}

describe("ClaudeCodeLoop turn budget", () => {
  afterEach(() => vi.mocked(query).mockReset());

  it("hands the model a turns-remaining nudge before each request once the threshold is reached, and the nudged evaluator reports", async () => {
    const { loop, events } = ccHarness(7);
    const nudges: (string | undefined)[] = [];
    const calls = scriptQueries([
      async function* (call) {
        yield init("s1");
        for (let i = 1; i <= 3; i++) {
          yield* bashTurn(i);
          // PostToolBatch fires once per batch of tool results, right before the next model request.
          const out = await hook(call.options, "PostToolBatch")({ hook_event_name: "PostToolBatch", tool_calls: [] } as any, undefined, { signal: new AbortController().signal });
          nudges.push((out as any).hookSpecificOutput?.additionalContext);
        }
        // Turn 4 of 7: the scripted evaluator obeys the nudge.
        yield assistant("m4", [{ type: "tool_use", id: "t4", name: "mcp__reins__report_evaluation", input: {} }]);
        const client = await reinsClient(call.options);
        await client.callTool({ name: "report_evaluation", arguments: { results: [{ id: "C1", pass: true, evidence: "seen" }], summary: "nudged report" } });
        yield result("success");
      },
    ]);
    const r = await loop.run("check C1");
    expect(calls).toHaveLength(1);
    expect(r.reason).toBe("terminal");
    expect(r.forced).toBeUndefined();
    expect(r.terminalInput.summary).toBe("nudged report");
    // After turns 1 (6 left) nothing; after turn 2 (5 left) and turn 3 (4 left) the nudge, with the count.
    expect(nudges[0]).toBeUndefined();
    expect(nudges[1]).toMatch(/5 turns left.*report_evaluation now.*unverified/s);
    expect(nudges[2]).toMatch(/4 turns left/);
    expect(warnNotes(events).filter((t) => /turns? left/.test(t))).toEqual([expect.stringMatching(/evaluator has 5 turns left/), expect.stringMatching(/evaluator has 4 turns left/)]);
    expect(events.some((e) => e.type === "tool.called" && e.name === "report_evaluation")).toBe(true);
  });

  it("sends the model back to its terminal tool twice when it stops with plain text, then lets it stop", async () => {
    const { loop } = ccHarness(10);
    const stop = (loop as any).stopHook as (input: any, id: undefined, o: { signal: AbortSignal }) => Promise<any>;
    const o = { signal: new AbortController().signal };
    const first = await stop({ hook_event_name: "Stop", stop_hook_active: false }, undefined, o);
    expect(first.hookSpecificOutput).toEqual({ hookEventName: "Stop", additionalContext: expect.stringMatching(/^Please finish by calling report_evaluation/) });
    expect((await stop({ hook_event_name: "Stop", stop_hook_active: true }, undefined, o)).hookSpecificOutput).toBeTruthy();
    expect(await stop({ hook_event_name: "Stop", stop_hook_active: true }, undefined, o)).toEqual({});
  });

  it("makes one forced single-turn call on the same session at the cap, offering only the terminal tool", async () => {
    const { loop, events } = ccHarness(3);
    let forcedTools: string[] = [];
    const calls = scriptQueries([
      async function* () {
        yield init("s1");
        for (let i = 1; i <= 3; i++) yield* bashTurn(i);
        yield result("error_max_turns");
      },
      async function* (call) {
        expect(call.options.resume).toBe("s1");
        expect(call.options.maxTurns).toBe(1);
        expect(call.options.tools).toEqual([]);
        expect(call.options.hooks).toBeUndefined();
        expect(call.prompt).toMatch(/Turn budget exhausted.*3-turn cap.*report_evaluation now/s);
        const client = await reinsClient(call.options);
        forcedTools = (await client.listTools()).tools.map((t) => t.name);
        yield assistant("m4", [{ type: "tool_use", id: "t4", name: "mcp__reins__report_evaluation", input: {} }]);
        await client.callTool({ name: "report_evaluation", arguments: { results: [{ id: "C1", pass: true, evidence: "seen" }, { id: "C2", pass: false, unverified: true, evidence: "not reached" }], summary: "forced report" } });
        yield result("error_max_turns");
      },
    ]);
    const r = await loop.run("check C1 and C2");
    expect(calls).toHaveLength(2);
    expect(forcedTools).toEqual(["report_evaluation"]);
    expect(r.reason).toBe("terminal");
    expect(r.forced).toBe(true);
    expect(r.turns).toBe(4);
    expect(r.terminalInput.results).toHaveLength(2);
    expect(r.costUsd).toBeGreaterThan(0);
    const notes = warnNotes(events);
    expect(notes.some((t) => /reached the 3-turn cap without calling report_evaluation.*only that tool/.test(t))).toBe(true);
    expect(events.filter((e) => e.type === "turn.started")).toHaveLength(4);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("returns max_turns with the last text when even the forced call does not report", async () => {
    const { loop } = ccHarness(2);
    const calls = scriptQueries([
      async function* () {
        yield init("s1");
        for (let i = 1; i <= 2; i++) yield* bashTurn(i);
        yield result("error_max_turns");
      },
      async function* () {
        yield assistant("m3", [{ type: "text", text: "I was still checking C1 when the budget ran out." }], "end_turn");
        yield result("success");
      },
    ]);
    const r = await loop.run("check");
    expect(calls).toHaveLength(2);
    expect(r.reason).toBe("max_turns");
    expect(r.terminalTool).toBeUndefined();
    expect(r.finalText).toBe("I was still checking C1 when the budget ran out.");
  });

  it("through the orchestrator: a synthesised report briefs a non-empty fix round on the Claude Code engine", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "reins-cc-"));
    fs.writeFileSync(path.join(ws, "README.md"), "# Sample\n");
    execSync("git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init", { cwd: ws });
    const cfg = defaultRunConfig({
      task: "Add a greeting file",
      workspace: ws,
      engine: "claude-code",
      maxTurnsPerPhase: 5,
      maxFixRounds: 1,
      components: { planner: false, contracts: false, testsFirst: false, osSandbox: false, actionClassifier: false } as any,
      pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false },
    });
    let fixBrief = "";
    const calls = scriptQueries([
      // build
      async function* (call) {
        yield init("sb");
        yield assistant("b1", [{ type: "tool_use", id: "tb1", name: "mcp__reins__finish", input: {} }]);
        await (await reinsClient(call.options)).callTool({ name: "finish", arguments: { summary: "built", open_items: [] } });
        yield result("success");
      },
      // evaluate round 1: out of turns, no report
      async function* () {
        yield init("se1");
        for (let i = 1; i <= 5; i++) yield* bashTurn(i);
        yield result("error_max_turns");
      },
      // the forced call: text only
      async function* (call) {
        expect(call.options.resume).toBe("se1");
        yield assistant("m6", [{ type: "text", text: "Still starting the server." }], "end_turn");
        yield result("success");
      },
      // fix round, on the builder's session, briefed with the synthesised report
      async function* (call) {
        expect(call.options.resume).toBe("sb");
        fixBrief = call.prompt;
        yield assistant("b2", [{ type: "tool_use", id: "tb2", name: "mcp__reins__finish", input: {} }]);
        await (await reinsClient(call.options)).callTool({ name: "finish", arguments: { summary: "re-verified", open_items: [] } });
        yield result("success");
      },
      // evaluate round 2: reports on its own
      async function* (call) {
        yield init("se2");
        yield assistant("e1", [{ type: "tool_use", id: "te1", name: "mcp__reins__report_evaluation", input: {} }]);
        await (await reinsClient(call.options)).callTool({ name: "report_evaluation", arguments: { results: [{ id: "C1", pass: true, evidence: "ran it" }], summary: "all good" } });
        yield result("success");
      },
    ]);
    const bus = new RunBus("test-cc-orch", false);
    const events: RunEvent[] = [];
    bus.on("event", (e: RunEvent) => events.push(e));
    const control = { signal: new AbortController().signal, waitIfPaused: async () => {}, requestApproval: async () => ({ approved: true }), drainSteer: () => [], remainingBudget: () => 10 };
    const orch = new Orchestrator(null, cfg, bus, { ...control, requestPhaseApproval: async () => ({ approved: true }), requestContractApproval: async (c) => ({ approved: true, criteria: c }) });
    const r = await orch.run();
    expect(calls).toHaveLength(5);
    expect(r.ok).toBe(true);
    const evals = events.filter((e): e is Extract<RunEvent, { type: "evaluation.result" }> => e.type === "evaluation.result");
    expect(evals.map((e) => e.origin)).toEqual(["synthesised", "reported"]);
    expect(evals[0].results).toEqual([{ id: "C1", pass: false, unverified: true, evidence: expect.stringMatching(/ran out of turns \(5\)/) }]);
    expect(evals[0].summary).toMatch(/^No evaluation report: the evaluator ran out of turns \(5\) before reporting; 0 of 1 criteria were verified\./);
    expect(evals[0].summary).toContain("The evaluator's last words: Still starting the server.");
    expect(fixBrief).toContain("# Evaluation of the previous round");
    expect(fixBrief).toContain("- C1 UNVERIFIED:");
    expect(fixBrief).toContain("synthesised by the harness");
    const notes = warnNotes(events);
    expect(notes.some((t) => /reached the 5-turn cap without calling report_evaluation/.test(t))).toBe(true);
    expect(notes.some((t) => /a report was synthesised with every criterion unverified/.test(t))).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("zodShape", () => {
  it("expresses every Reins tool schema the MCP server exposes", () => {
    for (const name of ["propose_contract", "review_contract", "report_evaluation", "finish", "update_progress", "think", "list_lessons", "read_lesson"]) {
      const schema = (ALL_TOOLS[name]?.schema as any)?.input_schema;
      expect(schema, name).toBeTruthy();
      const shape = zodShape(schema);
      expect(Object.keys(shape).sort()).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("honours required, enums and nested arrays", () => {
    const shape = zodShape({
      type: "object",
      properties: {
        features: { type: "array", items: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["todo", "done"] } }, required: ["id", "status"] } },
        note: { type: "string" },
      },
      required: ["features"],
    });
    const schema = z.object(shape);
    expect(schema.safeParse({ features: [{ id: "F1", status: "todo" }] }).success).toBe(true);
    expect(schema.safeParse({ features: [{ id: "F1", status: "later" }] }).success).toBe(false);
    expect(schema.safeParse({ note: "x" }).success).toBe(false);
  });
});

describe("workspaceRelative", () => {
  it("relativizes absolute paths inside the workspace and leaves relative ones alone", () => {
    expect(workspaceRelative("/tmp/ws", "/tmp/ws/src/a.ts")).toBe("src/a.ts");
    expect(workspaceRelative("/tmp/ws", "src/a.ts")).toBe("src/a.ts");
    expect(workspaceRelative("/tmp/ws", "/etc/hosts")).toBe("../../etc/hosts");
  });
});
