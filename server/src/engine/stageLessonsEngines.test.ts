import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunConfig } from "../../../shared/types.js";
import { resolveRunInput } from "../presets.js";
import { firstMessage } from "../roles/prompts.js";
import { RunBus } from "./bus.js";
import { AgentLoop } from "./loop.js";
import { seededHome } from "../testLibrary.js";

// These tests read real lessons; lessons/ ships empty, so they run against the example library.
process.env.REINS_HOME = seededHome("reins-stage-engines-");
import { ClaudeCodeLoop } from "./claudeCodeLoop.js";

// Both engines get the phase's first message from roles/prompts.ts firstMessage,
// so the stageLessons switch must reach each: on (and by default) the block is in
// the first prompt the model sees, off it is not.

const prompts: string[] = [];
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...real,
    query: ({ prompt }: { prompt: string }) => {
      prompts.push(String(prompt));
      return (async function* () {})();
    },
  };
});

const control = { signal: new AbortController().signal, waitIfPaused: async () => {}, requestApproval: async () => ({ approved: true }), drainSteer: () => [], remainingBudget: () => 10 };
const opts = { role: "builder" as const, system: "sys", tools: ["read_file", "finish"], terminal: ["finish"], handlers: {}, maxTurns: 3 };

function configs(engine: RunConfig["engine"]) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "reins-stage-eng-"));
  const base = defaultRunConfig({ ...resolveRunInput({ task: "Add a --version flag", workspace: ws, presets: ["careful", "golang", "cli"] }), engine, id: "eng-test" });
  const { stageLessons: _omit, ...defaulted } = base.components as any;
  return {
    ws,
    on: { ...base, components: { ...base.components, stageLessons: true } },
    defaulted: defaultRunConfig({ ...base, components: defaulted }),
    off: { ...base, components: { ...base.components, stageLessons: false } },
  };
}

function fakeClient(calls: any[]) {
  return {
    beta: {
      messages: {
        stream: (params: any) => {
          calls.push(structuredClone(params));
          const msg = { id: "m", type: "message", role: "assistant", model: params.model, content: [{ type: "tool_use", id: "f", name: "finish", input: { summary: "ok", open_items: [] } }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
          return { finalMessage: async () => msg };
        },
      },
    },
  } as any;
}

describe("stageLessons on both engines", () => {
  it("defaults on", () => {
    const { defaulted, ws } = configs("anthropic");
    expect(defaulted.components.stageLessons).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("direct API: the build first message carries the block when on or defaulted, not when off", async () => {
    const c = configs("anthropic");
    for (const [name, cfg] of Object.entries({ on: c.on, defaulted: c.defaulted, off: c.off })) {
      const calls: any[] = [];
      await new AgentLoop(fakeClient(calls), cfg, new RunBus(`eng-${name}`, false), control, opts).run(firstMessage("build", cfg));
      const first = JSON.stringify(calls[0].messages[0].content);
      if (name === "off") expect(first).not.toContain("Lessons for this stage");
      else expect(first).toContain("Lessons for this stage");
    }
    fs.rmSync(c.ws, { recursive: true, force: true });
  });

  it("claude-code: the prompt handed to the SDK carries the block when on or defaulted, not when off", async () => {
    const c = configs("claude-code");
    for (const [name, cfg] of Object.entries({ on: c.on, defaulted: c.defaulted, off: c.off })) {
      prompts.length = 0;
      await new ClaudeCodeLoop(cfg, new RunBus(`cc-${name}`, false), control, opts).run(firstMessage("build", cfg));
      expect(prompts).toHaveLength(1);
      if (name === "off") expect(prompts[0]).not.toContain("Lessons for this stage");
      else expect(prompts[0]).toContain("Lessons for this stage");
    }
    fs.rmSync(c.ws, { recursive: true, force: true });
  });
});
