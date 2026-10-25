import { describe, expect, it } from "vitest";
import { defaultRunConfig } from "../../shared/components.js";
import { applyPreset, BUILT_IN_PRESETS, checkRunConfig, diffFromDefaults, presetFromConfig, sanitizePresetName, validatePresetConfig } from "../../shared/config.js";
import type { RunConfig } from "../../shared/types.js";

const base = () => defaultRunConfig({ task: "t", workspace: "/tmp" });
const preset = (name: string) => BUILT_IN_PRESETS.find((p) => p.name === name)!;
const engineIgnored = (cfg: RunConfig) => checkRunConfig(cfg).filter((w) => w.message.includes("ignored on this engine"));

describe("checkRunConfig", () => {
  it("returns [] for the default anthropic config", () => {
    expect(checkRunConfig(defaultRunConfig({ task: "t", workspace: "/tmp" }))).toEqual([]);
  });

  it("(a) flags components that the chosen engine ignores", () => {
    const w = checkRunConfig({ ...base(), engine: "claude-code" });
    const ids = w.filter((x) => x.message.includes("ignored on this engine")).map((x) => x.component).sort();
    expect(ids).toEqual(["compaction", "contextEditing", "scouts", "taskBudget", "toolExamples", "toolSearch"]);
    expect(w.every((x) => x.level === "warn" || x.level === "info")).toBe(true);
  });

  it("(b) flags unmet requires: resetWithHandoff on with progressFile off", () => {
    const cfg = base();
    cfg.components.resetWithHandoff = true;
    cfg.components.progressFile = false;
    const w = checkRunConfig(cfg);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: "warn", component: "resetWithHandoff" });
    expect(w[0].message).toContain("Progress notes");
  });

  it("(c) flags no-op settings for phases that will not run", () => {
    const cfg = base();
    cfg.components.evaluator = false;
    cfg.components.contracts = false;
    cfg.pauses.afterEvaluation = true;
    cfg.pauses.afterContract = true;
    cfg.maxFixRounds = 2;
    const settings = checkRunConfig(cfg).map((w) => w.setting);
    expect(settings).toEqual(expect.arrayContaining(["maxFixRounds", "pauses.afterEvaluation", "pauses.afterContract"]));
    // With the evaluator back on, fix rounds and the evaluation pause mean something again.
    cfg.components.evaluator = true;
    expect(checkRunConfig(cfg).map((w) => w.setting)).toEqual(["pauses.afterContract"]);
  });

  it("(d) flags suspicious numbers", () => {
    const cfg = base();
    cfg.context.resetAtTokens = 100_000;
    cfg.context.compactAtTokens = 150_000;
    cfg.budgetUsd = 0.5;
    cfg.maxTurnsPerPhase = 3;
    const settings = checkRunConfig(cfg).map((w) => w.setting);
    expect(settings).toEqual(["context.resetAtTokens", "budgetUsd", "maxTurnsPerPhase"]);
  });

  it("does not throw on a legacy or partial config", () => {
    const cfg: any = base();
    delete cfg.pauses;
    delete cfg.context;
    expect(() => checkRunConfig(cfg)).not.toThrow();
    expect(checkRunConfig(cfg)).toEqual([]);
    expect(() => checkRunConfig({})).not.toThrow();
    expect(() => checkRunConfig(null)).not.toThrow();
    expect(() => checkRunConfig({ components: "nope", guardrail: 3, engine: "replay" } as any)).not.toThrow();
  });
});

describe("presets", () => {
  it("no built-in preset carries task, workspace, id or createdAt", () => {
    expect(BUILT_IN_PRESETS.map((p) => p.name)).toEqual(["Full", "Minimal", "Careful", "Claude Code"]);
    for (const p of BUILT_IN_PRESETS) for (const k of ["task", "workspace", "id", "createdAt"]) expect(Object.keys(p.config), `${p.name}.${k}`).not.toContain(k);
  });

  it("Full gives zero diffs", () => {
    expect(diffFromDefaults(applyPreset(base(), preset("Full")))).toEqual([]);
    expect(diffFromDefaults(base())).toEqual([]);
  });

  it("Minimal leaves only narration, actionClassifier and osSandbox on, and lists each one switched off", () => {
    const cfg = applyPreset(base(), preset("Minimal"));
    expect(Object.entries(cfg.components).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(["actionClassifier", "narration", "osSandbox"]);
    const diff = diffFromDefaults(cfg);
    // thinkTool is off by default (the post's Dec 2025 update), so Minimal does not list it.
    for (const id of ["planner", "contracts", "evaluator", "scouts", "featureList", "progressFile", "projectMemory", "gitCommits", "compaction", "contextEditing", "taskBudget", "toolSearch", "toolExamples", "skills", "selfVerification"]) {
      const d = diff.find((x) => x.path === `components.${id}`);
      expect(d, id).toBeDefined();
      expect(d!.text).toMatch(/: off \(default on\)$/);
    }
    expect(diff.find((x) => x.path === "components.planner")!.text).toBe("Planner: off (default on)");
    // Minimal is coherent: no no-op pauses or fix rounds.
    expect(checkRunConfig(cfg)).toEqual([]);
  });

  it("Careful sets guardrail ask and every pause on", () => {
    const cfg = applyPreset(base(), preset("Careful"));
    expect(cfg.guardrail.mode).toBe("ask");
    expect(Object.values(cfg.pauses).every(Boolean)).toBe(true);
    expect(checkRunConfig(cfg)).toEqual([]);
  });

  it("Claude Code preset with the claude-code engine has no engine-ignored warnings; Full with it does", () => {
    expect(engineIgnored(applyPreset({ ...base(), engine: "claude-code" }, preset("Claude Code")))).toEqual([]);
    expect(applyPreset(base(), preset("Claude Code")).engine).toBe("claude-code");
    expect(engineIgnored(applyPreset({ ...base(), engine: "claude-code" }, preset("Full"))).length).toBeGreaterThan(0);
  });

  it("applyPreset keeps the base task, workspace, id and createdAt and records the preset", () => {
    const b = { ...base(), task: "keep me", workspace: "/keep", id: "abc", createdAt: "2026-01-01T00:00:00.000Z" };
    for (const p of BUILT_IN_PRESETS) {
      const out = applyPreset(b, p);
      expect(out).toMatchObject({ task: "keep me", workspace: "/keep", id: "abc", createdAt: "2026-01-01T00:00:00.000Z", preset: p.name });
    }
    // A partial preset only changes what it names.
    const out = applyPreset(b, { name: "p", config: { pauses: { afterPlan: true } } });
    expect(out.pauses).toEqual({ ...b.pauses, afterPlan: true });
  });

  it("defaultRunConfig keeps an optional preset name (createRun records it)", () => {
    expect(defaultRunConfig({ task: "t", workspace: "/tmp", preset: "Minimal" }).preset).toBe("Minimal");
    expect("preset" in defaultRunConfig({ task: "t", workspace: "/tmp" })).toBe(false);
  });

  it("presetFromConfig round-trips through applyPreset", () => {
    const cfg = applyPreset(base(), preset("Careful"));
    expect(diffFromDefaults(applyPreset(base(), { name: "x", config: presetFromConfig(cfg) }))).toEqual(diffFromDefaults(cfg));
  });
});

describe("validatePresetConfig", () => {
  it("drops unknown keys, unknown component ids and forbidden keys, and reports them", () => {
    const { config, dropped } = validatePresetConfig({ components: { planner: false, bogusComp: true }, bogusKey: 1, task: "x", workspace: "/tmp", id: "i", createdAt: "c" });
    expect(config).toEqual({ components: { planner: false } });
    expect(dropped.sort()).toEqual(["bogusKey", "components.bogusComp", "createdAt", "id", "task", "workspace"]);
  });

  it("rejects wrong types with a one-line message", () => {
    expect(() => validatePresetConfig("nope")).toThrow(/config must be/);
    expect(() => validatePresetConfig({ budgetUsd: "lots" })).toThrow(/budgetUsd must be a non-negative number/);
    expect(() => validatePresetConfig({ components: { planner: "yes" } })).toThrow(/components.planner must be true or false/);
    expect(() => validatePresetConfig({ guardrail: { mode: "yolo" } })).toThrow(/guardrail.mode/);
  });

  it("sanitises names so they can never be paths", () => {
    expect(sanitizePresetName("../../evil")).toBe("evil");
    expect(sanitizePresetName("my preset 1")).toBe("my preset 1");
    expect(sanitizePresetName("/etc/passwd")).toBe("etc-passwd");
    expect(sanitizePresetName("...")).toBe("");
  });
});
