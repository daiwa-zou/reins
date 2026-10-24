import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated home and a short scripted recording, set before the modules read them.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "reins-rm-"));
process.env.REINS_HOME = home;
const demo = path.join(home, "scripted.jsonl");
const t = (s: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + s).toISOString();
const ev = (seq: number, body: object) => JSON.stringify({ seq, ts: t(seq), runId: "x", ...body });
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
fs.writeFileSync(
  demo,
  [
    ev(0, { type: "phase.started", phase: "build", round: 1 }),
    ev(1, { type: "turn.started", role: "builder", turn: 1 }),
    ev(2, { type: "turn.finished", role: "builder", turn: 1, usage, costUsd: 0.5 }),
    ev(3, { type: "phase.finished", phase: "build", round: 1, summary: "built", costUsd: 0.5, durationMs: 3 }),
  ].join("\n") + "\n",
);
process.env.REINS_DEMO_FILE = demo;

const { RunManager } = await import("./runManager.js");

afterEach(() => vi.useRealTimers());

describe("RunManager runs pushes", () => {
  it("pushes runs after turn.finished and phase.finished of a scripted run", async () => {
    const m = new RunManager();
    m.runsThrottleMs = 0; // observe every push in this test; throttling is tested below
    const log: string[] = [];
    m.on("event", (e: { type: string }) => log.push(e.type));
    m.on("runs", () => log.push(`runs:${m.listRuns()[0]?.costUsd ?? 0}`));
    const cfg = m.createRun({ task: "t", workspace: home, engine: "replay" });
    await vi.waitFor(() => expect(m.isActive(cfg.id)).toBe(false), { timeout: 5000, interval: 50 });
    await new Promise((r) => setTimeout(r, 10));
    const after = (type: string) => log.slice(log.indexOf(type) + 1).find((x) => x.startsWith("runs:") || !x.includes(":"));
    expect(after("turn.finished")).toMatch(/^runs:/);
    expect(after("phase.finished")).toMatch(/^runs:/);
    // the push after turn.finished already carries the new cost
    expect(log[log.indexOf("turn.finished") + 1]).toBe("runs:0.5");
  });

  it("throttles a burst of events to at most about one push per second", () => {
    vi.useFakeTimers();
    const m = new RunManager();
    let emits = 0;
    m.on("runs", () => emits++);
    for (let i = 0; i < 300; i++) {
      m.notifyRuns();
      vi.advanceTimersByTime(10); // 300 events over 3 s
    }
    vi.advanceTimersByTime(2000);
    expect(emits).toBeGreaterThanOrEqual(3);
    expect(emits).toBeLessThanOrEqual(5);
  });
});
