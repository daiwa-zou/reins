// Test kit for driving the loop and the orchestrator against a scripted
// stand-in for the Messages API. Not a test file: vitest only picks up *.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { LoopControl } from "./loop.js";
import type { OrchestratorControl } from "./orchestrator.js";
import { RunBus } from "./bus.js";
import type { RunEvent } from "../../../shared/types.js";

/**
 * Each call pops the next scripted response; a `fn` response can look at the
 * request (tools offered, messages so far) and assert on it.
 */
export type Scripted = Partial<Anthropic.Beta.BetaMessage> | ((params: any) => Partial<Anthropic.Beta.BetaMessage>);

export function fakeClient(script: Scripted[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: any) => {
          calls.push(params);
          const next = script.shift();
          if (!next) throw new Error(`script exhausted after ${calls.length} calls`);
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

export const toolUse = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input }) as any;
export const text = (t: string) => ({ type: "text", text: t }) as any;
/** A one-call response that calls one tool. */
export const call = (id: string, name: string, input: any): Scripted => ({ content: [toolUse(id, name, input)], stop_reason: "tool_use" });

export function control(overrides: Partial<OrchestratorControl> = {}): OrchestratorControl {
  const base: LoopControl = {
    signal: new AbortController().signal,
    waitIfPaused: async () => {},
    requestApproval: async () => ({ approved: true }),
    drainSteer: () => [],
    remainingBudget: () => 100,
  };
  return { ...base, requestPhaseApproval: async () => ({ approved: true }), requestContractApproval: async (c) => ({ approved: true, criteria: c }), ...overrides };
}

/** A git repo with a README and a package.json whose test script passes. */
export function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reins-ws-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# Sample\n");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "echo ok" } }));
  execSync("git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init", { cwd: dir });
  return dir;
}

export function collect(bus: RunBus) {
  const events: RunEvent[] = [];
  bus.on("event", (e: RunEvent) => events.push(e));
  return events;
}

/** The last user message of a request as a string (the phase's first message, or a tool result batch). */
export function lastUserText(params: any): string {
  const m = [...params.messages].reverse().find((x: any) => x.role === "user");
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return m.content.map((b: any) => (typeof b.content === "string" ? b.content : b.text ?? JSON.stringify(b))).join("\n");
}

export const phasesOf = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "phase.started" }> => e.type === "phase.started");
