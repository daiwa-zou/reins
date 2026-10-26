import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS, COMPONENT_IDS, DEFAULT_PUBLISH, defaultRunConfig, EFFORT_COMPONENTS, EFFORT_LEVELS, EFFORT_TABLE, FOUNDATIONS, PAUSE_GATE, PAUSE_KEYS, SUPERVISION_LEVELS, SUPERVISION_TABLE } from "../../shared/components.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIRECT_ONLY = ["toolSearch", "toolExamples", "compaction", "contextEditing", "taskBudget", "scouts"];
const BOTH = ["thinkTool", "skills", "actionClassifier", "osSandbox", "planner", "contracts", "evaluator", "featureList", "progressFile", "projectMemory", "gitCommits", "selfVerification", "resetWithHandoff", "workPackages", "testsFirst", "publish"];

describe("tiers and the Effort / Supervision tables", () => {
  it("every component has the tier of spec §1; actionClassifier is the only engine-tier one", () => {
    const effort = ["planner", "contracts", "evaluator", "scouts", "taskBudget", "thinkTool"];
    for (const c of COMPONENTS) expect(c.tier, c.id).toBe(c.id === "actionClassifier" ? "engine" : effort.includes(c.id) ? "effort" : "always");
    expect(COMPONENTS.filter((c) => c.tier === "always")).toHaveLength(17);
    expect([...EFFORT_COMPONENTS]).toEqual(effort);
  });
  it("EFFORT_TABLE has exactly the spec's cells", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "max"]);
    const bits = (id: (typeof EFFORT_COMPONENTS)[number]) => EFFORT_LEVELS.map((e) => (EFFORT_TABLE[e].components[id] ? "1" : "0")).join("");
    expect({ planner: bits("planner"), contracts: bits("contracts"), evaluator: bits("evaluator"), scouts: bits("scouts"), taskBudget: bits("taskBudget"), thinkTool: bits("thinkTool") }).toEqual({ planner: "0111", contracts: "0011", evaluator: "0111", scouts: "0011", taskBudget: "0111", thinkTool: "0001" });
    expect(EFFORT_LEVELS.map((e) => EFFORT_TABLE[e].maxFixRounds)).toEqual([0, 1, 2, 3]);
    expect(EFFORT_LEVELS.map((e) => EFFORT_TABLE[e].maxTurnsPerPhase)).toEqual([30, 60, 90, 120]);
    expect(EFFORT_LEVELS.map((e) => EFFORT_TABLE[e].budgetUsd)).toEqual([3, 10, 20, 40]);
    expect(EFFORT_LEVELS.map((e) => EFFORT_TABLE[e].rerunEveryCriterion)).toEqual([false, false, false, true]);
  });
  it("SUPERVISION_TABLE has the spec's pauses, modes, labels and chips", () => {
    expect(SUPERVISION_LEVELS).toEqual(["unattended", "check-in", "ask-every-write"]);
    expect(SUPERVISION_LEVELS.map((s) => SUPERVISION_TABLE[s].label)).toEqual(["Unattended", "Check in at gates", "Ask before every write"]);
    expect(SUPERVISION_LEVELS.map((s) => SUPERVISION_TABLE[s].chip)).toEqual(["Unattended", "Check in", "Ask every write"]);
    expect(SUPERVISION_LEVELS.map((s) => SUPERVISION_TABLE[s].mode)).toEqual(["auto", "auto", "ask"]);
    expect(SUPERVISION_LEVELS.map((s) => SUPERVISION_TABLE[s].actionClassifier)).toEqual([true, true, false]);
    expect(SUPERVISION_TABLE.unattended.pauses).toEqual({ afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false, beforeMerge: false });
    expect(SUPERVISION_TABLE["check-in"].pauses).toEqual({ afterPlan: true, afterContract: true, beforeCommit: false, afterEvaluation: true, beforeMerge: true });
    expect(SUPERVISION_TABLE["ask-every-write"].pauses).toEqual({ afterPlan: true, afterContract: true, beforeCommit: true, afterEvaluation: true, beforeMerge: true });
    expect(PAUSE_KEYS).toEqual(["afterPlan", "afterContract", "beforeCommit", "afterEvaluation", "beforeMerge"]);
    expect(PAUSE_GATE.beforeMerge).toBe("publish");
  });
  it("defaultRunConfig takes its budgets from EFFORT_TABLE (medium)", () => {
    const d = defaultRunConfig({ task: "t", workspace: "/w" });
    expect([d.maxFixRounds, d.maxTurnsPerPhase, d.budgetUsd]).toEqual([EFFORT_TABLE.medium.maxFixRounds, EFFORT_TABLE.medium.maxTurnsPerPhase, EFFORT_TABLE.medium.budgetUsd]);
    expect(d.components.resetWithHandoff).toBe(true);
  });
});

describe("component catalogue", () => {
  it("has 24 components, each with whenOff and a non-empty engines subset", () => {
    expect(COMPONENTS).toHaveLength(24);
    for (const c of COMPONENTS) {
      expect(c.whenOff.trim().length, c.id).toBeGreaterThan(10);
      expect(c.engines.length, c.id).toBeGreaterThan(0);
      for (const e of c.engines) expect(["anthropic", "claude-code"]).toContain(e);
    }
  });

  it("engine lists match what claudeCodeLoop and the orchestrator honour", () => {
    for (const id of DIRECT_ONLY) expect(COMPONENTS.find((c) => c.id === id)!.engines, id).toEqual(["anthropic"]);
    for (const id of BOTH) expect(COMPONENTS.find((c) => c.id === id)!.engines, id).toContain("claude-code");
  });

  it("work packages are always on, on both engines, and need no other component (with the planner off the run is one package)", () => {
    const wp = COMPONENTS.find((c) => c.id === "workPackages")!;
    expect(wp).toMatchObject({ tier: "always", group: "roles", defaultOn: true, engines: ["anthropic", "claude-code"] });
    expect(wp.requires ?? []).toEqual([]);
    expect(wp.whenOff).toMatch(/one package/);
  });

  it("tests first is always on, on both engines, and needs no other component", () => {
    const tf = COMPONENTS.find((c) => c.id === "testsFirst")!;
    expect(tf).toMatchObject({ tier: "always", group: "roles", defaultOn: true, engines: ["anthropic", "claude-code"] });
    expect(tf.requires ?? []).toEqual([]);
    expect(tf.short).toMatch(/fail/);
  });

  it("publish is always on, on both engines; the default config pauses before each merge and carries the publish policy", () => {
    const pub = COMPONENTS.find((c) => c.id === "publish")!;
    expect(pub).toMatchObject({ tier: "always", group: "roles", defaultOn: true, engines: ["anthropic", "claude-code"] });
    expect(pub.whenOff).toMatch(/no pull request/i);
    const d = defaultRunConfig({ task: "t", workspace: "/w" });
    expect(d.pauses.beforeMerge).toBe(true);
    expect(d.publish).toEqual(DEFAULT_PUBLISH);
    expect(defaultRunConfig({ task: "t", workspace: "/w", publish: { mergeWhen: "checks" } as any }).publish).toEqual({ ...DEFAULT_PUBLISH, mergeWhen: "checks" });
  });

  it("requires ids exist", () => {
    for (const c of COMPONENTS)
      for (const r of c.requires ?? []) {
        expect(COMPONENT_IDS, `${c.id} requires ${r.id}`).toContain(r.id);
        expect(r.id).not.toBe(c.id);
        expect(r.reason.length).toBeGreaterThan(5);
      }
    expect(COMPONENTS.find((c) => c.id === "resetWithHandoff")!.requires?.map((r) => r.id)).toContain("progressFile");
  });

  it("catalogue slugs resolve to files in lessons/", () => {
    for (const c of [...COMPONENTS, ...FOUNDATIONS]) for (const slug of c.lessons) expect(fs.existsSync(path.join(root, "lessons", `${slug}.md`)), `${c.id} -> ${slug}`).toBe(true);
  });
});
