import { describe, expect, it } from "vitest";
import { groupTrials, trialRates } from "../../../shared/components.js";
import type { RunSummary, Trial } from "../../../shared/types.js";

const run = (id: string, workspace = "/w", status: RunSummary["status"] = "completed"): RunSummary => ({
  id,
  title: "t",
  status,
  round: 1,
  costUsd: 1,
  workspace,
  engine: "anthropic",
  model: "m",
  createdAt: `2026-01-0${id}T00:00:00Z`,
  updatedAt: "",
  eventCount: 1,
});
const trial = (id: string, verdict: Trial["verdict"], status: Trial["status"] = "completed", title = "Add /health"): Trial => ({
  runId: id,
  title,
  status,
  verdict,
  costUsd: 1,
  durationMs: 1000,
  fixRounds: 0,
  createdAt: `2026-01-0${id}T00:00:00Z`,
  engine: "anthropic",
  model: "m",
});

describe("trial rates", () => {
  it("computes pass^k and pass@k from the observed rate", () => {
    const r = trialRates(3, 4, 3);
    expect(r.passRate).toBeCloseTo(0.75);
    expect(r.passPowK).toBeCloseTo(0.421875);
    expect(r.passAtK).toBeCloseTo(1 - 0.015625);
    expect(trialRates(0, 0, 3)).toEqual({ passRate: 0, passPowK: 0, passAtK: 0 });
  });
});

describe("groupTrials", () => {
  it("groups by task text and workspace, ignores running and replay runs in the rates", () => {
    const runs = [run("1"), run("2"), run("3", "/w", "running"), run("4", "/other"), { ...run("5"), engine: "replay" as const }];
    const trials = new Map<string, Trial>([
      ["1", trial("1", "pass")],
      ["2", trial("2", "fail", "failed")],
      ["3", trial("3", "none", "running")],
      ["4", trial("4", "pass")],
      ["5", trial("5", "pass")],
    ]);
    const sets = groupTrials(runs, trials, 2);
    expect(sets).toHaveLength(2);
    const w = sets.find((s) => s.workspace === "/w")!;
    expect(w.trials).toHaveLength(3);
    expect(w.n).toBe(2);
    expect(w.passes).toBe(1);
    expect(w.passRate).toBe(0.5);
    expect(w.passPowK).toBe(0.25);
    expect(w.passAtK).toBe(0.75);
  });
  it("treats whitespace variants of the same task as one set", () => {
    const runs = [run("1"), run("2")];
    const trials = new Map<string, Trial>([
      ["1", trial("1", "pass", "completed", "Add  /health\n")],
      ["2", trial("2", "pass", "completed", "Add /health")],
    ]);
    expect(groupTrials(runs, trials)).toHaveLength(1);
  });
});
