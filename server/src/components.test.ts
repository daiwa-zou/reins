import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS, COMPONENT_IDS, FOUNDATIONS } from "../../shared/components.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIRECT_ONLY = ["toolSearch", "toolExamples", "compaction", "contextEditing", "taskBudget", "scouts"];
const BOTH = ["thinkTool", "skills", "actionClassifier", "osSandbox", "planner", "contracts", "evaluator", "featureList", "progressFile", "projectMemory", "gitCommits", "selfVerification", "resetWithHandoff"];

describe("component catalogue", () => {
  it("has 21 components, each with whenOff and a non-empty engines subset", () => {
    expect(COMPONENTS).toHaveLength(21);
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
