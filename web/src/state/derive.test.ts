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
    expect(m.phases.map((p) => `${p.phase}${p.round || ""}`)).toEqual(["plan", "contract", "build1", "evaluate1", "build2", "evaluate2", "publish", "wrapup"]);
    expect(m.contract).toHaveLength(7);
    expect(m.evaluations.map((e) => e.verdict)).toEqual(["fail", "pass"]);
    // The builder checked every criterion off itself during the build rounds; the evaluator's verdict then settled them.
    expect(Object.keys(m.checks).sort()).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7"]);
    expect(m.pullRequests).toHaveLength(1);
    expect(m.pullRequests[0].merged).toBeTruthy();
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
  it("keeps a turn's text and tool calls together when context edits, notes or steers land mid-turn", () => {
    // The direct engine's order: turn.finished and the context events come before the turn's text and tool calls.
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
    const evs = [
      { runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "turn.started", role: "builder", turn: 1 },
      { runId: "r", seq: 1, ts: "2026-01-01T00:00:01.000Z", type: "turn.finished", role: "builder", turn: 1, usage, costUsd: 0.01, stopReason: "tool_use", model: "m" },
      { runId: "r", seq: 2, ts: "2026-01-01T00:00:01.000Z", type: "context.cleared", role: "builder", clearedToolResults: 3, tokensFreed: 5000 },
      { runId: "r", seq: 3, ts: "2026-01-01T00:00:01.000Z", type: "text", role: "builder", text: "Looking at the tests." },
      { runId: "r", seq: 4, ts: "2026-01-01T00:00:01.000Z", type: "steer.received", text: "hurry", deliveredTo: "next" },
      { runId: "r", seq: 5, ts: "2026-01-01T00:00:02.000Z", type: "tool.called", role: "builder", toolUseId: "t1", name: "bash", input: { command: "ls" }, narration: "Running ls" },
      { runId: "r", seq: 6, ts: "2026-01-01T00:00:02.000Z", type: "note", level: "warn", text: "Tool output contains instruction-shaped text." },
      { runId: "r", seq: 7, ts: "2026-01-01T00:00:03.000Z", type: "tool.called", role: "builder", toolUseId: "t2", name: "read_file", input: { path: "a" }, narration: "Reading a" },
    ] as unknown as RunEvent[];
    const m = derive(evs);
    const turns = m.feed.filter((f) => f.kind === "turn") as any[];
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Looking at the tests.");
    expect(turns[0].calls.map((c: any) => c.toolUseId)).toEqual(["t1", "t2"]);
    expect(turns[0].finishedTs).toBe("2026-01-01T00:00:01.000Z");
    expect(m.feed.filter((f) => f.kind === "note")).toHaveLength(1);
  });
  it("ends a turn that a retried model call starts again, so it is not shown as working forever", () => {
    const evs = [
      { runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "turn.started", role: "builder", turn: 1 },
      { runId: "r", seq: 1, ts: "2026-01-01T00:00:05.000Z", type: "note", level: "warn", text: "Transient API error; retrying in 5s." },
      { runId: "r", seq: 2, ts: "2026-01-01T00:00:10.000Z", type: "turn.started", role: "builder", turn: 1 },
    ] as unknown as RunEvent[];
    const turns = derive(evs).feed.filter((f) => f.kind === "turn") as any[];
    expect(turns).toHaveLength(2);
    expect(turns[0].finishedTs).toBe("2026-01-01T00:00:10.000Z");
    expect(turns[1].finishedTs).toBeUndefined();
  });
  it("tells evaluation rounds of different packages apart and knows which package the contract is for", () => {
    const p1 = { id: "P1", title: "First", index: 1, total: 2 };
    const p2 = { id: "P2", title: "Second", index: 2, total: 2 };
    const c = (id: string) => ({ id, text: id, verify: "run", hard: true });
    const res = (id: string, pass: boolean) => ({ id, pass, evidence: "seen" });
    const evs = [
      { runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "phase.started", phase: "contract", round: 0, package: p1 },
      { runId: "r", seq: 1, ts: "2026-01-01T00:00:01.000Z", type: "contract.agreed", criteria: [c("C1")] },
      { runId: "r", seq: 2, ts: "2026-01-01T00:00:02.000Z", type: "phase.started", phase: "evaluate", round: 1, package: p1 },
      { runId: "r", seq: 3, ts: "2026-01-01T00:00:03.000Z", type: "evaluation.result", round: 1, results: [res("C1", true)], verdict: "pass", summary: "ok" },
      { runId: "r", seq: 4, ts: "2026-01-01T00:00:04.000Z", type: "phase.started", phase: "contract", round: 0, package: p2 },
      { runId: "r", seq: 5, ts: "2026-01-01T00:00:05.000Z", type: "contract.agreed", criteria: [c("C2")] },
      { runId: "r", seq: 6, ts: "2026-01-01T00:00:06.000Z", type: "phase.started", phase: "evaluate", round: 1, package: p2 },
      { runId: "r", seq: 7, ts: "2026-01-01T00:00:07.000Z", type: "evaluation.result", round: 1, results: [res("C2", false)], verdict: "fail", summary: "no" },
    ] as unknown as RunEvent[];
    const m = derive(evs);
    expect(m.evaluations.map((e) => `${e.package?.id}#${e.round}`)).toEqual(["P1#1", "P2#1"]);
    expect(m.contractPackage).toEqual(p2);
    expect(m.contract.map((x) => x.id)).toEqual(["C2"]);
  });
  it("checks criteria off as the builder verifies them, keeps the newest word per criterion, and forgets checks for a new contract", () => {
    const c = (id: string) => ({ id, text: id, verify: "run", hard: true });
    const evs = [
      { runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "contract.agreed", criteria: [c("C1"), c("C2")] },
      { runId: "r", seq: 1, ts: "2026-01-01T00:00:01.000Z", type: "criterion.checked", role: "builder", id: "C1", pass: false, evidence: "exit 1" },
      { runId: "r", seq: 2, ts: "2026-01-01T00:00:02.000Z", type: "criterion.checked", role: "builder", id: "C1", pass: true, evidence: "exit 0" },
      { runId: "r", seq: 3, ts: "2026-01-01T00:00:03.000Z", type: "criterion.checked", role: "builder", id: "C2", pass: true, evidence: "ok" },
      { runId: "r", seq: 4, ts: "2026-01-01T00:00:04.000Z", type: "contract.agreed", criteria: [c("C2"), c("C3")] },
    ] as unknown as RunEvent[];
    const mid = derive(evs, 3);
    expect(Object.keys(mid.checks).sort()).toEqual(["C1", "C2"]);
    expect(mid.checks.C1).toMatchObject({ pass: true, evidence: "exit 0", seq: 2 });
    expect(mid.feed.filter((f) => f.kind === "check")).toHaveLength(3);
    // The next contract keeps only the checks of criteria it still has (the tests stage re-agrees the same list plus T).
    const after = derive(evs);
    expect(Object.keys(after.checks)).toEqual(["C2"]);
  });
  it("knows the breakdown phase, between plan and contract", () => {
    expect(PHASE_ORDER).toEqual(["plan", "breakdown", "contract", "tests", "build", "evaluate", "publish", "wrapup"]);
    expect(PHASE_LABEL.publish).toBe("Publish");
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
  it("folds pr.opened and pr.merged into the pull request list and the feed", () => {
    const pkg = { id: "P1", title: "Say hello", index: 1, total: 2 };
    const evs = [
      { runId: "r", seq: 0, ts: "2026-01-01T00:00:00.000Z", type: "pr.opened", number: 7, url: "https://example.test/pr/7", branch: "reins/r-p1-say-hello", base: "main", package: pkg },
      { runId: "r", seq: 1, ts: "2026-01-01T00:10:00.000Z", type: "pr.merged", number: 7, url: "https://example.test/pr/7", branch: "reins/r-p1-say-hello", base: "main", sha: "abc" },
    ] as unknown as RunEvent[];
    const m = derive(evs);
    expect(m.pullRequests).toEqual([{ number: 7, url: "https://example.test/pr/7", branch: "reins/r-p1-say-hello", base: "main", package: pkg, openedTs: "2026-01-01T00:00:00.000Z", merged: { sha: "abc", ts: "2026-01-01T00:10:00.000Z" } }]);
    expect(m.feed.map((f) => f.kind)).toEqual(["pr", "pr"]);
    expect((m.feed[1] as any).what).toBe("merged");
    const withRound = derive([evs[0], { runId: "r", seq: 1, ts: "2026-01-01T00:05:00.000Z", type: "pr.feedback", number: 7, url: "https://example.test/pr/7", round: 1, comments: 2, checks: ["ci"], summary: "Fixed." } as unknown as RunEvent, evs[1]]);
    expect(withRound.pullRequests[0].rounds).toEqual([{ round: 1, comments: 2, checks: ["ci"], summary: "Fixed.", ts: "2026-01-01T00:05:00.000Z" }]);
    expect((withRound.feed[1] as any)).toMatchObject({ kind: "pr", what: "feedback", round: 1, comments: 2, checks: ["ci"] });
    // Feedback the person skipped is a row of its own; a round the person trimmed says how much of the feedback it addressed.
    const withSkip = derive([
      evs[0],
      { runId: "r", seq: 1, ts: "2026-01-01T00:03:00.000Z", type: "pr.skipped", number: 7, url: "https://example.test/pr/7", comments: 1, checks: ["lint"], note: "flaky" },
      { runId: "r", seq: 2, ts: "2026-01-01T00:05:00.000Z", type: "pr.feedback", number: 7, url: "https://example.test/pr/7", round: 1, comments: 2, checks: [], summary: "Fixed.", addressed: { kept: 2, of: 3 } },
    ]);
    expect((withSkip.feed[1] as any)).toMatchObject({ kind: "pr", what: "skipped", comments: 1, checks: ["lint"], summary: "flaky" });
    expect(withSkip.pullRequests[0].rounds).toEqual([{ round: 1, comments: 2, checks: [], summary: "Fixed.", ts: "2026-01-01T00:05:00.000Z", addressed: { kept: 2, of: 3 } }]);
  });
});
