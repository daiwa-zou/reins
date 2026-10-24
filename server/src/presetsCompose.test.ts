import { describe, expect, it } from "vitest";
import type { Lesson, Preset } from "../../shared/types.js";
import { defaultRunConfig } from "../../shared/components.js";
import { applyPreset, BUILT_IN_PRESETS, checkRunConfig, diffFromDefaults, presetFromConfig, validatePresetConfig } from "../../shared/config.js";
import { adaptPreset, composePreset, composeRun, PresetCompositionError, generatedPresets, isGeneratedPresetName, PRESET_RECIPES, presetCompatibility, recipeFor } from "../../shared/presets.js";
import { parseLesson } from "../../shared/lessons.js";
import { systemPromptFor } from "./roles/prompts.js";

const preset = (name: string) => BUILT_IN_PRESETS.find((p) => p.name === name)!;
const lesson = (slug: string, date: string, extra: Partial<Lesson>): Lesson => ({ slug, title: slug, date, url: "", takeaway: "t", learnings: ["l"], implications: ["i"], components: [], foundations: [], tags: [], source: "user", items: [], standing: "reviewed", ...extra });

describe("presetCompatibility", () => {
  it("Full and Careful need Direct API and name direct-only components", () => {
    for (const n of ["Full", "Careful"]) {
      const c = presetCompatibility(preset(n), "claude-code");
      expect(c.ok).toBe(false);
      expect(c.reasons.join(" ")).toMatch(/Direct API/);
      expect(c.reasons.join(" ")).toMatch(/Scout/);
      expect(c.reasons.join(" ")).toMatch(/Compaction/);
      expect(presetCompatibility(preset(n), "anthropic").ok).toBe(true);
    }
  });
  it("Minimal fits both engines; Claude Code fits only claude-code", () => {
    expect(presetCompatibility(preset("Minimal"), "claude-code").ok).toBe(true);
    expect(presetCompatibility(preset("Minimal"), "anthropic").ok).toBe(true);
    expect(presetCompatibility(preset("Claude Code"), "claude-code").ok).toBe(true);
    expect(presetCompatibility(preset("Claude Code"), "anthropic").ok).toBe(false);
  });
  it("an adaptive preset fits claude-code, lists what it drops, and leaves no ignored warnings once applied", () => {
    const web = composePreset(recipeFor("web"), []);
    const c = presetCompatibility(web, "claude-code");
    expect(c).toMatchObject({ ok: true, adaptive: true });
    expect(c.dropped).toEqual(expect.arrayContaining(["scouts", "compaction", "contextEditing", "taskBudget", "toolSearch", "toolExamples"]));
    const cfg = applyPreset(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code" }), adaptPreset(web, "claude-code"));
    expect(checkRunConfig(cfg).filter((w) => /ignored/i.test(w.message))).toEqual([]);
  });
  it("user presets follow the same rule and presetFromConfig records the engine", () => {
    const cc = presetFromConfig(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code" }));
    expect(cc.engine).toBe("claude-code");
    const user: Preset = { name: "mine", description: "", builtIn: false, config: cc };
    expect(presetCompatibility(user, "anthropic").ok).toBe(false);
    const fullish: Preset = { name: "mine2", description: "", builtIn: false, config: { components: { scouts: true } } };
    expect(presetCompatibility(fullish, "claude-code").ok).toBe(false);
  });
});

const good = `---
title: Good
date: 2026-01-01
takeaway: x
domains: web, cli
enables: evaluator, selfVerification
disables: narration
guidance: Start the dev server with a timeout.
---
## Learnings
- a
## Harness implications
- [stage:build] b
  > a
`;
const withMeta = (meta: string) => good.replace(/domains:[\s\S]*?guidance:.*\n/, meta + "\n");

describe("parseLesson effect keys", () => {
  it("reads all four keys from a good file", () => {
    const { lesson, problems } = parseLesson("good", good);
    expect(problems).toEqual([]);
    expect(lesson).toMatchObject({ domains: ["web", "cli"], enables: ["evaluator", "selfVerification"], disables: ["narration"], guidance: "Start the dev server with a timeout." });
  });
  it("lessons without the keys parse as before", () => {
    const { lesson, problems } = parseLesson("plain", withMeta(""));
    expect(problems).toEqual([]);
    expect(lesson).not.toHaveProperty("domains");
    expect(lesson).not.toHaveProperty("enables");
  });
  it("errors on an unknown component, a component in both lists and a bad domain", () => {
    const err = (meta: string) => parseLesson("x", withMeta(meta)).problems.filter((p) => p.level === "error").map((p) => p.message).join("\n");
    expect(err("domains: web\nenables: notAComponent")).toMatch(/notAComponent/);
    expect(err("domains: web\nenables: evaluator\ndisables: evaluator")).toMatch(/both enables/);
    expect(err("domains: Web App!")).toMatch(/invalid domain/);
  });
  it("effect keys without domains are a warning, not an error", () => {
    const { problems } = parseLesson("x", withMeta("enables: evaluator"));
    expect(problems.filter((p) => p.level === "error")).toEqual([]);
    expect(problems.some((p) => p.level === "warn" && /domains/.test(p.message))).toBe(true);
  });
});

describe("composePreset", () => {
  it("the recipe list has web and cli", () => {
    expect(PRESET_RECIPES.map((r) => r.id)).toEqual(expect.arrayContaining(["web", "cli"]));
  });
  it("a web lesson's enables turn the component on and show in the basis", () => {
    const p = composePreset(recipeFor("web"), [lesson("a", "2025-01-01", { domains: ["web"], enables: ["resetWithHandoff"] }), lesson("other", "2025-01-01", { domains: ["cli"], enables: ["scouts"] })]);
    expect(p.name).toBe("Web app");
    expect(p.config.components!.resetWithHandoff).toBe(true);
    expect(p.basis!.map((b) => b.slug)).toEqual(["a"]);
    expect(p.basis![0].effect).toMatch(/on: .*Reset/i);
    expect(p).toMatchObject({ generated: true, adaptive: true, domain: "web" });
  });
  it("newest lesson wins a conflict and the loser's basis says so", () => {
    const old = lesson("old", "2024-01-01", { domains: ["web"], enables: ["narration"] });
    const neu = lesson("new", "2026-01-01", { domains: ["web"], disables: ["narration"] });
    for (const order of [[old, neu], [neu, old]]) {
      const p = composePreset(recipeFor("web"), order);
      expect(p.config.components!.narration).toBe(false);
      expect(p.basis!.find((b) => b.slug === "old")!.effect).toMatch(/overridden by new/);
    }
  });
  it("a lesson-only domain gives a generic preset on the Full base", () => {
    const all = generatedPresets([lesson("g", "2025-01-01", { domains: ["games"], disables: ["scouts"] })]);
    const games = all.find((p) => p.domain === "games")!;
    expect(games.name).toBe("Games");
    expect(games.config.components!.scouts).toBe(false);
    expect(games.config.components!.planner).toBe(true);
    expect(all.map((p) => p.name)).toEqual(expect.arrayContaining(["Web app", "CLI / tool", "Games"]));
  });
  it("generated names are reserved, also after sanitising", () => {
    expect(isGeneratedPresetName("CLI / tool")).toBe(true);
    expect(isGeneratedPresetName("cli - tool")).toBe(true);
    expect(isGeneratedPresetName("web app")).toBe(true);
    expect(isGeneratedPresetName("mine")).toBe(false);
  });
  it("duplicate guidance lines appear once", () => {
    const g = "Hit the endpoint with curl.";
    const p = composePreset(recipeFor("web"), [lesson("a", "2025-01-01", { domains: ["web"], guidance: g }), lesson("b", "2025-02-01", { domains: ["web"], guidance: g })]);
    expect(p.config.guidance!.filter((x) => x === g)).toHaveLength(1);
  });
});

describe("run guidance", () => {
  it("validatePresetConfig drops non-strings, caps count and length, strips newlines", () => {
    const a = validatePresetConfig({ guidance: [1, "ok"] });
    expect(a.config.guidance).toEqual(["ok"]);
    expect(a.dropped).toContain("guidance[0]");
    expect(validatePresetConfig({ guidance: Array.from({ length: 15 }, (_, i) => `line ${i}`) }).config.guidance).toHaveLength(10);
    expect(validatePresetConfig({ guidance: ["x".repeat(500)] }).config.guidance![0].length).toBe(200);
    expect(validatePresetConfig({ guidance: ["one\ntwo"] }).config.guidance).toEqual(["one two"]);
    expect(() => validatePresetConfig({ guidance: "nope" })).toThrow(/guidance/);
  });
  it("applyPreset, presetFromConfig and diffFromDefaults carry guidance", () => {
    const cfg = applyPreset(defaultRunConfig({ task: "t", workspace: "/w" }), { name: "g", config: { guidance: ["Use curl."] } });
    expect(cfg.guidance).toEqual(["Use curl."]);
    expect(presetFromConfig(cfg).guidance).toEqual(["Use curl."]);
    expect(diffFromDefaults(cfg).find((c) => c.path === "guidance")?.text).toMatch(/1 line/);
  });
  it("defaultRunConfig keeps valid guidance (the run-creation path)", () => {
    expect(defaultRunConfig({ task: "t", workspace: "/w", guidance: ["a", 3 as any, "b\nc"] }).guidance).toEqual(["a", "b c"]);
  });
  it("systemPromptFor appends the guidance for every role", () => {
    const cfg = defaultRunConfig({ task: "t", workspace: "/w", guidance: ["Run --help first.", "Check stderr."] });
    for (const role of ["builder", "evaluator", "planner"] as const) {
      const p = systemPromptFor(role, cfg);
      expect(p).toContain("Guidance for this run");
      expect(p).toContain("- Run --help first.");
      expect(p).toContain("- Check stderr.");
    }
    expect(systemPromptFor("builder", defaultRunConfig({ task: "t", workspace: "/w" }))).not.toContain("Guidance for this run");
  });
});

describe("composeRun refuses invalid compositions", () => {
  it("two profiles, no profile, or an unknown domain throw PresetCompositionError", () => {
    expect(() => composeRun(["full", "careful"], [])).toThrow(PresetCompositionError);
    expect(() => composeRun(["golang"], [])).toThrow(PresetCompositionError);
    expect(() => composeRun(["careful", "nosuchdomain"], [])).toThrow(PresetCompositionError);
    expect(composeRun(["careful", "golang", "cli"], []).presets).toEqual(["careful", "golang", "cli"]);
  });
});
