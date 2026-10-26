import { describe, expect, it } from "vitest";
import type { RunSummary } from "../../../shared/types";
import { groupRuns, runContextLine } from "./runGroups";

const now = Date.parse("2026-10-26T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const run = (id: string, status: RunSummary["status"], extra: Partial<RunSummary> = {}): RunSummary => ({ id, title: id, status, round: 0, costUsd: 0, workspace: "/w", engine: "claude-code", model: "m", createdAt: ago(60), updatedAt: ago(5), eventCount: 1, ...extra });

describe("groupRuns: the run list reads by urgency", () => {
  it("puts runs waiting for you first, then live ones, then everything else newest first; empty groups are left out", () => {
    const runs = [run("done-old", "completed", { updatedAt: ago(600) }), run("live", "running", { updatedAt: ago(1) }), run("ask", "waiting_approval", { updatedAt: ago(2) }), run("done-new", "completed", { updatedAt: ago(30) }), run("paused", "paused", { updatedAt: ago(3) }), run("failed", "failed", { updatedAt: ago(100) })];
    expect(groupRuns(runs).map((g) => [g.id, g.label, g.runs.map((r) => r.id)])).toEqual([
      ["needs", "Needs you", ["ask"]],
      ["live", "Running", ["live", "paused"]],
      ["earlier", "Earlier", ["done-new", "failed", "done-old"]],
    ]);
    expect(groupRuns([run("a", "completed")]).map((g) => g.id)).toEqual(["earlier"]);
    expect(groupRuns([])).toEqual([]);
  });
});

describe("runContextLine: one line that says where a run is", () => {
  it("a live run: the phase, its package and the time since it started", () => {
    expect(runContextLine(run("x", "running", { phase: "build", round: 1, package: { id: "P2", title: "Say bye", index: 2, total: 3 }, createdAt: ago(6.6) }), now)).toBe("Build P2 of 3 · 6m 36s");
    expect(runContextLine(run("x", "running", { phase: "evaluate", round: 2, createdAt: ago(10) }), now)).toBe("Evaluate · round 2 · 10m 0s");
    expect(runContextLine(run("x", "paused", { phase: "build", round: 1, createdAt: ago(1) }), now)).toBe("Paused in Build · 1m 0s");
    expect(runContextLine(run("x", "queued", { createdAt: ago(0) }), now)).toBe("Queued");
  });
  it("a run waiting for you: says so, with the phase it stopped in and how long ago", () => {
    expect(runContextLine(run("x", "waiting_approval", { phase: "publish", package: { id: "P1", title: "Say hello", index: 1, total: 2 }, updatedAt: ago(2) }), now)).toBe("Waiting for you · Publish P1 of 2 · 2m ago");
    expect(runContextLine(run("x", "waiting_approval", { phase: "contract", updatedAt: ago(2) }), now)).toBe("Waiting for you · Contract · 2m ago");
  });
  it("a finished run: the outcome, where it failed, and when", () => {
    expect(runContextLine(run("x", "completed", { phase: "wrapup", updatedAt: ago(60 * 26) }), now)).toBe("Completed · yesterday");
    expect(runContextLine(run("x", "failed", { phase: "evaluate", round: 2, updatedAt: ago(60 * 50) }), now)).toBe("Failed in Evaluate · 2d ago");
    expect(runContextLine(run("x", "cancelled", { phase: "build", updatedAt: ago(30) }), now)).toBe("Stopped in Build · 30m ago");
    expect(runContextLine(run("x", "completed", { engine: "replay", updatedAt: ago(30) }), now)).toBe("Completed · demo · 30m ago");
  });
});
