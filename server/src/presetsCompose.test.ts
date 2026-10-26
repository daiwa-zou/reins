import { describe, expect, it } from "vitest";
import type { Lesson, Preset } from "../../shared/types.js";
import { defaultRunConfig } from "../../shared/components.js";
import { applyPreset, checkRunConfig, diffFromDefaults, presetFromConfig, validatePresetConfig } from "../../shared/config.js";
import { adaptPreset, composePreset, composeRun, compositionConfig, compositionLabel, compositionOf, inferComposition, migrateLegacy, runChipLabel, type PresetRecipe, PresetCompositionError, generatedPresets, isGeneratedPresetName, PRESET_RECIPES, presetCompatibility, recipeFor } from "../../shared/presets.js";
import { EFFORT_TABLE } from "../../shared/components.js";
import { parseLesson } from "../../shared/lessons.js";
import { catalogueProblems } from "../../shared/implications.js";
import { systemPromptFor } from "./roles/prompts.js";

// The retired built-in presets in migrated form (see shared/presets.ts migrateLegacy).
const preset = (name: string): Pick<Preset, "name" | "config"> => {
  const m = migrateLegacy(name);
  return { name, config: { ...compositionConfig(m.effort, m.supervision), ...(m.engine ? { engine: m.engine } : {}) } };
};
/** A legacy id list (["careful","golang","cli"]) as the new composition input. */
const legacy = (ids: string[]) => {
  const m = migrateLegacy(ids);
  return { effort: m.effort, supervision: m.supervision, domains: ids.filter((x) => !["full", "minimal", "careful"].includes(x)) };
};
const lesson = (slug: string, date: string, extra: Partial<Lesson>): Lesson => ({ slug, title: slug, date, url: "", takeaway: "t", learnings: ["l"], implications: ["i"], components: [], foundations: [], tags: [], source: "user", items: [], standing: "reviewed", ...extra });

describe("presetCompatibility", () => {
  it("Full and Careful follow the claude-code engine and name the direct-only components they drop", () => {
    for (const n of ["Full", "Careful"]) {
      const c = presetCompatibility(preset(n), "claude-code");
      expect(c.ok).toBe(true);
      expect(c.reasons.join(" ")).toMatch(/Follows Claude Code/);
      if (n === "Careful") expect(c.reasons.join(" ")).toMatch(/Scout/);
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
    expect(c.dropped).toEqual(expect.arrayContaining(["compaction", "contextEditing", "taskBudget", "toolSearch", "toolExamples"]));
    const cfg = applyPreset(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code" }), adaptPreset(web, "claude-code"));
    expect(checkRunConfig(cfg).filter((w) => /ignored/i.test(w.message))).toEqual([]);
  });
  it("user presets follow the same rule and presetFromConfig records the engine", () => {
    const cc = presetFromConfig(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code" }));
    expect(cc.engine).toBe("claude-code");
    const user: Preset = { name: "mine", description: "", builtIn: false, config: cc };
    expect(presetCompatibility(user, "anthropic").ok).toBe(false);
    const fullish: Preset = { name: "mine2", description: "", builtIn: false, config: { components: { scouts: true } } };
    // Engine-follow: a direct-only switch no longer makes a preset unfit; it is dropped on that engine.
    expect(presetCompatibility(fullish, "claude-code").ok).toBe(true);
    expect(presetCompatibility(fullish, "claude-code").dropped).toContain("scouts");
  });
});

const good = `---
title: Good
date: 2026-01-01
takeaway: x
domains: web, cli
enables: evaluator, thinkTool
disables: scouts
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
    expect(lesson).toMatchObject({ domains: ["web", "cli"], enables: ["evaluator", "thinkTool"], disables: ["scouts"], guidance: "Start the dev server with a timeout." });
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
    const p = composePreset(recipeFor("web"), [lesson("a", "2025-01-01", { domains: ["web"], enables: ["thinkTool"] }), lesson("other", "2025-01-01", { domains: ["cli"], enables: ["scouts"] })]);
    expect(p.name).toBe("Web app");
    expect(p.config.components!.thinkTool).toBe(true);
    expect(p.basis!.map((b) => b.slug)).toEqual(["a"]);
    expect(p.basis![0].effect).toMatch(/on: .*Think/i);
    expect(p).toMatchObject({ generated: true, adaptive: true, domain: "web" });
  });
  it("newest lesson wins a conflict and the loser's basis says so", () => {
    const old = lesson("old", "2024-01-01", { domains: ["web"], enables: ["thinkTool"] });
    const neu = lesson("new", "2026-01-01", { domains: ["web"], disables: ["thinkTool"] });
    for (const order of [[old, neu], [neu, old]]) {
      const p = composePreset(recipeFor("web"), order);
      expect(p.config.components!.thinkTool).toBe(false);
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
  it("an unknown effort, an unknown supervision or an unknown domain throw PresetCompositionError", () => {
    expect(() => composeRun({ effort: "extreme" as any }, [])).toThrow(PresetCompositionError);
    expect(() => composeRun({ supervision: "sometimes" as any }, [])).toThrow(/supervision/);
    expect(() => composeRun(legacy(["careful", "nosuchdomain"]), [])).toThrow(PresetCompositionError);
    expect(composeRun(legacy(["careful", "golang", "cli"]), [])).toMatchObject({ effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] });
  });
});

describe("composeRun merges roles and context later-wins per key, guardrail only tightens; no domain owns the engine", () => {
  const recipes: PresetRecipe[] = [
    ...PRESET_RECIPES,
    {
      id: "aa",
      name: "AA",
      description: "test domain aa",
      guidance: [],
      config: {
        roles: { builder: { model: "model-aa" }, evaluator: { effort: "low" } },
        context: { compactAtTokens: 1111, resetAtTokens: 5555 },
        guardrail: { allowNetwork: true, askPatterns: ["^aa-only"] },
      },
    },
    {
      id: "bb",
      name: "BB",
      description: "test domain bb",
      guidance: [],
      config: {
        roles: { builder: { model: "model-bb" } },
        context: { compactAtTokens: 2222 },
        guardrail: { allowNetwork: false },
      },
    },
    { id: "eng", name: "Eng", description: "a domain that tries to pick the engine", guidance: [], config: { engine: "claude-code", context: { compactAtTokens: 3333 } } },
  ];

  it("(a) the later domain wins per key, keys only the earlier domain set are kept", () => {
    const careful = preset("Careful").config;
    const c = composeRun(legacy(["careful", "aa", "bb"]), [], recipes).config;
    // overridden by the later domain (bb)
    expect(c.roles?.builder?.model).toBe("model-bb");
    expect(c.context?.compactAtTokens).toBe(2222);
    expect(c.guardrail?.allowNetwork).toBe(false);
    // set only by the earlier domain (aa): kept
    expect(c.roles?.evaluator?.effort).toBe("low");
    expect(c.context?.resetAtTokens).toBe(5555);
    expect(c.guardrail?.askPatterns).toEqual(["^aa-only"]);
    // set by neither domain: the profile's value stays
    expect(c.guardrail?.mode).toBe("ask");
    expect(c.roles?.builder?.effort).toBe(careful.roles?.builder?.effort);
    expect(c.context?.clearToolResultsAfterTurns).toBe(careful.context?.clearToolResultsAfterTurns);

    // reversed order: aa is now later and wins
    const r = composeRun(legacy(["careful", "bb", "aa"]), [], recipes);
    expect(r.config.roles?.builder?.model).toBe("model-aa");
    expect(r.config.context?.compactAtTokens).toBe(1111);
    // allowNetwork: true would loosen supervision, so it is refused in either order and recorded.
    expect(r.config.guardrail?.allowNetwork).toBe(false);
    expect(r.basis.find((b) => b.slug === "recipe:aa")!.effect).toMatch(/refused: allowNetwork/);
  });

  it("(b) a domain recipe that sets engine does not change the profile's engine", () => {
    for (const profile of ["full", "minimal", "careful"]) {
      const profileEngine = preset(profile[0].toUpperCase() + profile.slice(1)).config.engine;
      const c = composeRun(legacy([profile, "eng"]), [], recipes).config;
      expect(c.engine).toBe(profileEngine);
      if (profileEngine === undefined) expect("engine" in c).toBe(false);
      expect(c.context?.compactAtTokens).toBe(3333); // the rest of the recipe still applies
    }
  });

  it("defaults to PRESET_RECIPES, so two-argument callers are unchanged", () => {
    expect(composeRun(legacy(["careful", "golang", "cli"]), [])).toEqual(composeRun(legacy(["careful", "golang", "cli"]), [], PRESET_RECIPES));
    expect(() => composeRun(legacy(["careful", "aa"]), [])).toThrow(PresetCompositionError);
  });
});

describe("hostile domain: layering can only raise effort and tighten supervision", () => {
  const hostile: PresetRecipe = {
    id: "hostile",
    name: "Hostile",
    description: "tries every loosening",
    guidance: [],
    config: {
      components: { planner: false, evaluator: false, contracts: false, compaction: false, actionClassifier: true },
      pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false },
      maxFixRounds: 0,
      maxTurnsPerPhase: 5,
      budgetUsd: 1,
      guardrail: { mode: "trust", allowNetwork: true, allowPatterns: [".*"] },
    },
  };
  const evil = lesson("evil", "2026-01-01", { domains: ["hostile"], disables: ["planner", "evaluator", "scouts", "compaction", "actionClassifier"], enables: ["actionClassifier", "progressFile"] });
  it("the effort and supervision results equal the dial's, and every refusal is recorded in the basis", () => {
    for (const [effort, supervision] of [["high", "ask-every-write"], ["medium", "check-in"]] as const) {
      const dial = composeRun({ effort, supervision, domains: [] }, []).config;
      const c = composeRun({ effort, supervision, domains: ["hostile"] }, [evil], [...PRESET_RECIPES, hostile]);
      expect(c.config.components).toEqual(dial.components);
      expect(c.config.pauses).toEqual(dial.pauses);
      expect(c.config.guardrail?.mode).toBe(dial.guardrail?.mode);
      expect(c.config.guardrail?.allowNetwork).toBe(false);
      expect(c.config.guardrail?.allowPatterns ?? []).toEqual([]);
      for (const k of ["maxFixRounds", "maxTurnsPerPhase", "budgetUsd"] as const) expect(c.config[k], k).toBe(EFFORT_TABLE[effort][k]);
      const recipeFx = c.basis.find((b) => b.slug === "recipe:hostile")!.effect;
      for (const re of [/refused: off: Planner/, /refused: pause afterPlan off/, /refused: maxFixRounds 0/, /refused: maxTurnsPerPhase 5/, /refused: budgetUsd 1/, /refused: guardrail mode trust/, /refused: allowNetwork/, /refused: allowPatterns/, /ignored: Compaction is always on/]) expect(recipeFx).toMatch(re);
      const lessonFx = c.basis.find((b) => b.slug === "evil")!.effect;
      expect(lessonFx).toMatch(/refused: off: Planner/);
      expect(lessonFx).toMatch(/ignored: Progress notes is always on|ignored: .* is always on/);
      if (supervision === "ask-every-write") expect(lessonFx).toMatch(/refused: on: Action classifier/);
    }
  });
  it("a lesson's enables: of an always-tier id is ignored by composition", () => {
    const l = lesson("comp", "2026-01-01", { domains: ["golang"], disables: ["compaction"] });
    const c = composeRun({ effort: "low", supervision: "unattended", domains: ["golang"] }, [l]);
    expect(c.config.components!.compaction).toBe(true);
  });
  it("an [effort:max] recommendation for a picked domain is listed but leaves the composed effort at the dial's", () => {
    const l = lesson("rec", "2026-01-01", { items: [{ id: "rec#1", lesson: "rec", date: "2026-01-01", kind: "effort", target: "max", claim: "Go work needs max.", quote: "q", domains: ["golang"], standing: "reviewed" }] });
    const c = composeRun({ effort: "medium", supervision: "check-in", domains: ["golang"] }, [l]);
    expect(c.effort).toBe("medium");
    expect(c.config.maxFixRounds).toBe(EFFORT_TABLE.medium.maxFixRounds);
    expect(c.config.components!.thinkTool).toBe(false);
    expect(c.recommendations).toEqual([expect.objectContaining({ slug: "rec", level: "max", domain: "golang" })]);
  });
});

describe("legacy migration on read", () => {
  it("maps the retired ids and names as in the spec table", () => {
    expect(migrateLegacy(["full"])).toMatchObject({ effort: "medium", supervision: "check-in", domains: [] });
    expect(migrateLegacy("Full")).toMatchObject({ effort: "medium", supervision: "check-in" });
    expect(migrateLegacy(["minimal"])).toMatchObject({ effort: "low", supervision: "unattended" });
    expect(migrateLegacy("Minimal")).toMatchObject({ effort: "low", supervision: "unattended" });
    expect(migrateLegacy(["careful", "golang", "cli"])).toEqual({ effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] });
    expect(migrateLegacy("Careful")).toMatchObject({ effort: "high", supervision: "ask-every-write" });
    expect(migrateLegacy("Claude Code")).toEqual({ effort: "medium", supervision: "check-in", domains: [], engine: "claude-code" });
    expect(migrateLegacy("Web app")).toEqual({ effort: "medium", supervision: "check-in", domains: ["web"] });
    expect(migrateLegacy("CLI / tool")).toEqual({ effort: "medium", supervision: "check-in", domains: ["cli"] });
    expect(migrateLegacy("Go")).toEqual({ effort: "medium", supervision: "check-in", domains: ["golang"] });
    expect(migrateLegacy("Python")).toEqual({ effort: "medium", supervision: "check-in", domains: ["python"] });
    expect(migrateLegacy("Careful · Go · CLI")).toEqual({ effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] });
  });
  it("old runs keep their chip text; new runs get the composition label", () => {
    expect(runChipLabel({ presets: ["careful", "golang", "cli"] })).toBe("Careful · Go · CLI");
    expect(compositionOf({ presets: ["careful", "golang", "cli"] })).toMatchObject({ effort: "high", supervision: "ask-every-write" });
    expect(runChipLabel({ effort: "high", supervision: "check-in", domains: ["golang", "cli"] })).toBe("High · Check in · Go · CLI");
    expect(runChipLabel({ effort: "medium", supervision: "check-in", domains: [], ablated: ["compaction"] })).toBe("Medium · Check in · Experiment: without Compaction");
    expect(compositionLabel({ effort: "low", supervision: "ask-every-write", domains: ["web"] })).toBe("Low · Ask every write · Web");
  });
  it("infers a composition for a legacy saved preset", () => {
    expect(inferComposition({ guardrail: { mode: "ask" } }).supervision).toBe("ask-every-write");
    expect(inferComposition({ pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false } }).supervision).toBe("unattended");
    expect(inferComposition({ pauses: { afterContract: true } }).supervision).toBe("check-in");
    expect(inferComposition({ components: { contracts: true } }).effort).toBe("high");
    expect(inferComposition({ components: { contracts: false, planner: false, evaluator: false } }).effort).toBe("low");
    expect(inferComposition({ components: { contracts: false } }).effort).toBe("medium");
  });
  it("a saved preset may not turn an always-tier component off; a legacy entry's off is dropped", () => {
    expect(() => validatePresetConfig({ components: { compaction: false } })).toThrow(/compaction/);
    const l = validatePresetConfig({ components: { compaction: false, planner: false } }, { legacy: true });
    expect(l.config.components).toEqual({ planner: false });
    expect(l.dropped.join(" ")).toMatch(/compaction/);
  });
});

describe("lessons check: tiers and effort recommendations", () => {
  it("the always-tier no-trusted-backing warning fires for an always-tier component and not for an effort-tier one", () => {
    const w = catalogueProblems([]).map((p) => p.message);
    expect(w.some((m) => /"compaction" is always on \(always-tier\) but no bundled or reviewed implication/.test(m))).toBe(true);
    expect(w.some((m) => /"planner" is always on/.test(m))).toBe(false);
    // An unreviewed implication does not back the tier.
    const weak = lesson("weak", "2026-01-01", { standing: "unreviewed", items: [{ id: "weak#1", lesson: "weak", date: "2026-01-01", kind: "component", target: "compaction", claim: "c", quote: "q", domains: [], standing: "unreviewed" }] });
    expect(catalogueProblems([weak]).some((p) => /"compaction" is always on/.test(p.message))).toBe(true);
  });
  it("parses [effort:<level>] domains: d Claim, and an unknown level is an error naming it", () => {
    const md = (head: string) => good.replace("- [stage:build] b", head);
    const ok = parseLesson("e", md("- [effort:high] domains: web Web work needs a contract."));
    expect(ok.problems.filter((p) => p.level === "error")).toEqual([]);
    expect(ok.lesson!.items[0]).toMatchObject({ kind: "effort", target: "high", domains: expect.arrayContaining(["web"]) });
    expect(parseLesson("e", md("- [effort:extreme] domains: web X.")).problems.filter((p) => p.level === "error").map((p) => p.message).join(" ")).toMatch(/extreme/);
  });
  it("enables: of an always-tier id is a lint warning", () => {
    const { problems } = parseLesson("x", withMeta("domains: web\nenables: compaction"));
    expect(problems.some((p) => p.level === "warn" && /compaction.*always/.test(p.message))).toBe(true);
  });
});
