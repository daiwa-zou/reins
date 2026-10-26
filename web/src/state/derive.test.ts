import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derive, PHASE_LABEL, PHASE_ORDER } from "./derive";
import type { RunEvent } from "@shared/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const demo = fs
  .readFileSync(path.resolve(here, "../../../demo/sample-run.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as RunEvent);

describe("derive (fold of the event log)", () => {
  it("reconstructs the demo run end to end", () => {
    const m = derive(demo);
    expect(m.status).toBe("completed");
    expect(m.phases.map((p) => `${p.phase}${p.round || ""}`)).toEqual(["plan", "contract", "build1", "evaluate1", "build2", "evaluate2", "wrapup"]);
    expect(m.contract).toHaveLength(7);
    expect(m.evaluations.map((e) => e.verdict)).toEqual(["fail", "pass"]);
    expect(m.features.every((f) => f.status === "done")).toBe(true);
    expect(m.commits).toHaveLength(2);
    expect(m.pending).toHaveLength(0);
    expect(m.costUsd).toBeGreaterThan(0);
    expect(Math.abs(m.costUsd - (m.summary?.costUsd ?? 0))).toBeLessThan(1e-9);
    expect(m.calls.every((c) => c.result)).toBe(true);
    expect(m.guardrails.some((g) => g.source === "classifier")).toBe(true);
    expect(m.steers).toEqual([{ text: expect.any(String), delivered: true, ts: expect.any(String) }]);
  });

  it("scrubbing to an earlier seq shows the state at that time", () => {
    const agreed = demo.find((e) => e.type === "contract.agreed")!;
    const m = derive(demo, agreed.seq);
    expect(m.status).toBe("running");
    expect(m.contract).toHaveLength(7);
    expect(m.evaluations).toHaveLength(0);
    expect(m.currentPhase?.phase).toBe("contract");
  });

  it("keeps a pending approval until it is resolved", () => {
    const req = demo.find((e) => e.type === "approval.requested")!;
    const m = derive(demo, req.seq);
    expect(m.pending).toHaveLength(1);
    expect(m.pending[0].kind).toBe("contract");
  });
  it("sets a turn's end time after turn.finished", () => {
    const base = { runId: "r" } as const;
    const evs = [
      { ...base, seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "turn.started", role: "builder", turn: 1 },
      { ...base, seq: 1, ts: "2026-01-01T00:00:04.000Z", type: "turn.finished", role: "builder", turn: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.01 },
    ] as unknown as RunEvent[];
    const before = derive(evs, 0).feed.find((f) => f.kind === "turn") as any;
    expect(before.finishedTs).toBeUndefined();
    const after = derive(evs).feed.find((f) => f.kind === "turn") as any;
    expect(after.finishedTs).toBe("2026-01-01T00:00:04.000Z");
  });
  it("knows the breakdown phase, between plan and contract", () => {
    expect(PHASE_ORDER).toEqual(["plan", "breakdown", "contract", "tests", "build", "evaluate", "wrapup"]);
    expect(PHASE_LABEL.breakdown).toBe("Breakdown");
    expect(PHASE_LABEL.tests).toBe("Tests");
  });
  it("carries the work package of a phase into the phase list and the feed", () => {
    const pkg = { id: "P2", title: "Document the endpoint", index: 2, total: 2 };
    const evs = [
      { runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "phase.started", phase: "contract", round: 0, package: pkg },
      { runId: "r", seq: 1, ts: "2026-01-01T00:00:05.000Z", type: "phase.finished", phase: "contract", round: 0, package: pkg, summary: "2 criteria agreed", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.01, durationMs: 5000 },
      { runId: "r", seq: 2, ts: "2026-01-01T00:00:06.000Z", type: "phase.started", phase: "wrapup", round: 0 },
    ] as unknown as RunEvent[];
    const m = derive(evs);
    expect(m.phases.map((p) => p.package)).toEqual([pkg, undefined]);
    const item = m.feed.find((f) => f.kind === "phase") as any;
    expect(item.package).toEqual(pkg);
    expect(item.finished.summary).toBe("2 criteria agreed");
  });
  it("folds tests.agreed into the latest test plan and a feed item", () => {
    const plan = { command: "npm test", tests: [{ id: "T1", file: "t/a.test.ts", name: "a", criteria: ["C1"], kind: "unit", explains: "e" }], uncovered: [], explanation: "x" };
    const evs = [{ runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "tests.agreed", plan, red: { exitCode: 1, excerpt: "1 failed" } }] as unknown as RunEvent[];
    const m = derive(evs);
    expect(m.tests).toEqual({ plan, red: { exitCode: 1, excerpt: "1 failed" } });
    const item = m.feed.find((f) => f.kind === "tests") as any;
    expect(item.plan.tests).toHaveLength(1);
    expect(item.red.exitCode).toBe(1);
  });
});
