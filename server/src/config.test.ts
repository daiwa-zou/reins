import { describe, expect, it } from "vitest";
import { COMPONENTS, DEFAULT_PUBLISH, defaultRunConfig, EFFORT_LEVELS, SUPERVISION_LEVELS } from "../../shared/components.js";
import { applyPreset, checkRunConfig, diffFromDefaults, presetFromConfig, sanitizePresetName, validatePresetConfig } from "../../shared/config.js";
import { composeRun, compositionConfig, migrateLegacy } from "../../shared/presets.js";
import type { EngineId, Preset, RunConfig } from "../../shared/types.js";

const base = () => defaultRunConfig({ task: "t", workspace: "/tmp" });
// The retired built-in presets, in migrated form (Full → medium + check-in, Minimal → low + unattended,
// Careful → high + ask every write, Claude Code → medium + check-in on the claude-code engine).
const LEGACY_NAMES = ["Full", "Minimal", "Careful", "Claude Code"];
const preset = (name: string): Pick<Preset, "name" | "config"> => {
  const m = migrateLegacy(name);
  return { name, config: { ...compositionConfig(m.effort, m.supervision, m.engine), ...(m.engine ? { engine: m.engine } : {}) } };
};
const BUILT_IN_PRESETS = LEGACY_NAMES.map(preset);
const engineIgnored = (cfg: RunConfig) => checkRunConfig(cfg).filter((w) => w.message.includes("ignored on this engine"));

describe("checkRunConfig", () => {
  it("returns [] for the default anthropic config", () => {
    expect(checkRunConfig(defaultRunConfig({ task: "t", workspace: "/tmp" }))).toEqual([]);
  });

  it("(a) components the chosen engine ignores follow the engine: recorded off, never warned about", () => {
    const w = checkRunConfig({ ...base(), engine: "claude-code" });
    expect(w.filter((x) => x.message.includes("ignored on this engine"))).toEqual([]);
    const ids = Object.entries(compositionConfig("medium", "check-in", "claude-code").components!).filter(([, v]) => !v).map(([k]) => k).sort();
    expect(ids).toEqual(["compaction", "contextEditing", "contracts", "scouts", "taskBudget", "thinkTool", "toolExamples", "toolSearch"]);
    expect(w.every((x) => x.level === "warn" || x.level === "info")).toBe(true);
  });

  it("every effort × supervision × engine combination composes with zero checkRunConfig warnings", () => {
    for (const effort of EFFORT_LEVELS)
      for (const supervision of SUPERVISION_LEVELS)
        for (const engine of ["anthropic", "claude-code"] as EngineId[]) {
          const c = composeRun({ effort, supervision, domains: ["golang", "cli"] }, [], undefined, engine);
          const cfg = applyPreset({ ...base(), engine }, { name: c.label, config: c.config });
          expect(checkRunConfig(cfg), `${effort} ${supervision} ${engine}`).toEqual([]);
          for (const comp of COMPONENTS) if (!comp.engines.includes(engine)) expect(cfg.components[comp.id], `${comp.id} on ${engine}`).toBe(false);
        }
  });

  it("a claude-code composition raises zero checkRunConfig warnings", () => {
    const c = composeRun({ effort: "max", supervision: "ask-every-write", domains: [] }, [], undefined, "claude-code");
    expect(checkRunConfig({ ...applyPreset(base(), { name: c.label, config: c.config }), engine: "claude-code" })).toEqual([]);
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
  it("no composition carries task, workspace, id or createdAt; the dials have 4 and 3 ids", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "max"]);
    expect(SUPERVISION_LEVELS).toEqual(["unattended", "ask-to-publish", "check-in", "ask-every-write"]);
    for (const p of BUILT_IN_PRESETS) for (const k of ["task", "workspace", "id", "createdAt"]) expect(Object.keys(p.config), `${p.name}.${k}`).not.toContain(k);
  });

  it("Full (medium + check-in) differs from the defaults only by the effort and supervision tables", () => {
    expect(diffFromDefaults(applyPreset(base(), preset("Full"))).map((d) => d.path)).toEqual(["components.contracts", "components.scouts", "pauses.afterPlan", "pauses.afterContract", "pauses.afterEvaluation", "pauses.beforePublish"]);
    expect(diffFromDefaults(base())).toEqual([]);
  });

  it("Minimal (low + unattended) leaves the always-tier on and every effort-tier component off, and lists each one switched off", () => {
    const cfg = applyPreset(base(), preset("Minimal"));
    expect(Object.entries(cfg.components).filter(([, v]) => v).map(([k]) => k).sort()).toEqual([...COMPONENTS.filter((c) => c.tier === "always").map((c) => c.id), "actionClassifier"].sort());
    const diff = diffFromDefaults(cfg);
    // thinkTool is off by default (the post's Dec 2025 update), so low effort does not list it.
    for (const id of ["planner", "contracts", "evaluator", "scouts", "taskBudget"]) {
      const d = diff.find((x) => x.path === `components.${id}`);
      expect(d, id).toBeDefined();
      expect(d!.text).toMatch(/: off \(default on\)$/);
    }
    expect(diff.find((x) => x.path === "components.planner")!.text).toBe("Planner: off (default on)");
    // Low + unattended is coherent: no no-op pauses or fix rounds.
    expect(checkRunConfig(cfg)).toEqual([]);
  });

  it("Careful (high + ask every write) sets guardrail ask and every pause on", () => {
    const cfg = applyPreset(base(), preset("Careful"));
    expect(cfg.guardrail.mode).toBe("ask");
    expect(Object.values(cfg.pauses).every(Boolean)).toBe(true);
    expect(checkRunConfig(cfg)).toEqual([]);
  });

  it("Claude Code (medium + check-in on claude-code) and Full on claude-code have no engine-ignored warnings", () => {
    expect(engineIgnored(applyPreset({ ...base(), engine: "claude-code" }, preset("Claude Code")))).toEqual([]);
    expect(applyPreset(base(), preset("Claude Code")).engine).toBe("claude-code");
    expect(engineIgnored(applyPreset({ ...base(), engine: "claude-code" }, preset("Full")))).toEqual([]);
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

describe("publish policy", () => {
  it("the checker warns about a merge pause when publish is off, and validatePresetConfig keeps a well-formed publish block", () => {
    const cfg = defaultRunConfig({ task: "t", workspace: "/w" });
    cfg.components.publish = false;
    cfg.pauses.beforeMerge = true;
    expect(checkRunConfig(cfg).map((w) => w.setting)).toContain("pauses.beforeMerge");
    cfg.pauses.beforePublish = true;
    expect(checkRunConfig(cfg).map((w) => w.setting)).toContain("pauses.beforePublish");
    cfg.pauses.beforeReviewRound = true;
    cfg.pauses.beforeReviewReply = true;
    expect(checkRunConfig(cfg).map((w) => w.setting)).toEqual(expect.arrayContaining(["pauses.beforeReviewRound", "pauses.beforeReviewReply"]));
    const { config, dropped } = validatePresetConfig({ publish: { mergeWhen: "checks", mergeMethod: "rebase", pollSeconds: 5, maxWaitMinutes: 10, maxReviewRounds: 1, remote: "upstream", base: "develop", bogus: 1 } });
    expect(config.publish).toEqual({ mergeWhen: "checks", mergeMethod: "rebase", pollSeconds: 5, maxWaitMinutes: 10, maxReviewRounds: 1, remote: "upstream", base: "develop" });
    expect(dropped).toEqual(["publish.bogus"]);
    expect(() => validatePresetConfig({ publish: { mergeWhen: "sometimes" } })).toThrow(/publish.mergeWhen must be one of approved, checks, never/);
    expect(() => validatePresetConfig({ publish: { pollSeconds: -1 } })).toThrow(/publish.pollSeconds must be a non-negative number/);
    const applied = applyPreset(defaultRunConfig({ task: "t", workspace: "/w" }), { name: "p", config: { publish: { mergeWhen: "never" } } });
    expect(applied.publish).toEqual({ ...DEFAULT_PUBLISH, mergeWhen: "never" });
  });
});
