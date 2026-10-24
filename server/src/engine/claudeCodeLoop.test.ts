import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeCodeLoop, workspaceRelative, zodShape } from "./claudeCodeLoop.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";
import { ALL_TOOLS } from "../tools/registry.js";

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
