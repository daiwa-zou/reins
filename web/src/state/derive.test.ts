import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derive } from "./derive";
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
});
