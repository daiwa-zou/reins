import { describe, expect, it } from "vitest";
import { summarize } from "./runStore.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";

const cfg = defaultRunConfig({ id: "r1", task: "t", workspace: "/w" });
const ev = (seq: number, body: object): RunEvent => ({ seq, ts: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`, runId: "r1", ...body }) as RunEvent;
const pkg = { id: "P2", title: "Say bye", index: 2, total: 3 };

describe("summarize", () => {
  it("carries the package of the latest per-package phase, and drops it once a phase without one starts", () => {
    const s = summarize(cfg, [ev(0, { type: "run.status", status: "running" }), ev(1, { type: "phase.started", phase: "plan", round: 0 }), ev(2, { type: "phase.started", phase: "build", round: 1, package: pkg })]);
    expect(s).toMatchObject({ status: "running", phase: "build", round: 1, package: pkg });
    const done = summarize(cfg, [ev(0, { type: "phase.started", phase: "build", round: 1, package: pkg }), ev(1, { type: "phase.started", phase: "wrapup", round: 0 })]);
    expect(done.phase).toBe("wrapup");
    expect(done.package).toBeUndefined();
  });
});
