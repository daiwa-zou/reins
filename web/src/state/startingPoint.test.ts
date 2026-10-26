import { describe, expect, it } from "vitest";
import { generatedPresets } from "../../../shared/presets";
import type { Preset } from "../../../shared/types";
import { classifyPresets, describeStart, effortSummary, startingPointFor, supervisionSummary } from "./startingPoint";

const mine: Preset = { name: "mine", description: "", builtIn: false, config: {} };
// The retired built-ins as an old server would still list them.
const BUILT_IN_PRESETS: Preset[] = ["Full", "Minimal", "Careful", "Claude Code"].map((name) => ({ name, description: "", builtIn: true, config: {} }));
const list = [...BUILT_IN_PRESETS, ...generatedPresets([]), mine];
const names = (ps: Preset[]) => ps.map((p) => p.name);

describe("classifyPresets", () => {
  const c = classifyPresets(list);
  it("the retired Full, Minimal and Careful are no longer profiles (nor saved or domains)", () => {
    expect("profiles" in c).toBe(false);
    for (const n of ["Full", "Minimal", "Careful"]) expect(names([...c.saved, ...c.domains])).not.toContain(n);
  });
  it("generated presets become domains", () => {
    expect(names(c.domains)).toEqual(expect.arrayContaining(["Web app", "CLI / tool", "Go", "Python"]));
    expect(c.domains.every((p) => p.generated)).toBe(true);
  });
  it("user presets become saved, and only they do", () => {
    expect(names(c.saved)).toEqual(["mine"]);
  });
  it("'Claude Code' is never classified as saved (nor as a profile or domain)", () => {
    expect(names(c.saved)).not.toContain("Claude Code");
    expect(names(c.domains)).not.toContain("Claude Code");
  });
});

describe("startingPointFor", () => {
  const opts = { saved: ["mine"] };
  const mc = { kind: "compose", effort: "medium", supervision: "check-in" } as const;
  it("Full -> medium + check-in", () => expect(startingPointFor("Full", opts)).toEqual({ ...mc, domains: [] }));
  it("Careful -> high + ask every write", () => expect(startingPointFor("Careful", opts)).toEqual({ kind: "compose", effort: "high", supervision: "ask-every-write", domains: [] }));
  it("Minimal -> low + unattended", () => expect(startingPointFor("Minimal", opts)).toEqual({ kind: "compose", effort: "low", supervision: "unattended", domains: [] }));
  it("'Web app' -> medium + check-in + web", () => expect(startingPointFor("Web app", opts)).toEqual({ ...mc, domains: ["web"] }));
  it("'CLI / tool' -> medium + check-in + cli", () => expect(startingPointFor("CLI / tool", opts)).toEqual({ ...mc, domains: ["cli"] }));
  it("'Claude Code' -> medium + check-in on the claude-code engine", () => expect(startingPointFor("Claude Code", opts)).toEqual({ ...mc, domains: [], engine: "claude-code" }));
  it("a user preset name -> saved", () => {
    expect(startingPointFor("mine", opts)).toEqual({ kind: "saved", name: "mine" });
    expect(startingPointFor("mine (modified)", opts)).toEqual({ kind: "saved", name: "mine" });
  });
  it("an unknown name -> custom, without throwing", () => {
    expect(startingPointFor("gone", opts)).toEqual({ kind: "custom" });
    expect(startingPointFor(undefined)).toEqual({ kind: "custom" });
    expect(startingPointFor("Careful · Nope")).toEqual({ kind: "custom" });
  });
  it("a composed label maps back to ids", () => {
    expect(startingPointFor("Careful · Go · CLI")).toEqual({ kind: "compose", effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] });
    expect(startingPointFor("High · Check in · Go")).toEqual({ kind: "compose", effort: "high", supervision: "check-in", domains: ["golang"] });
    expect(describeStart({ kind: "compose", effort: "high", supervision: "ask-every-write", domains: ["web"] })).toBe("High · Ask every write · Web");
  });
});

describe("effortSummary: what an Effort level turns on, in plain words for the Harness page", () => {
  it("names the stages that run, the fix rounds, the turn cap and the budget", () => {
    expect(effortSummary("low")).toEqual({ stages: ["Tests", "Build", "Publish"], extras: [], fixRounds: 0, turns: 30, budgetUsd: 3 });
    expect(effortSummary("medium")).toEqual({ stages: ["Plan", "Breakdown", "Tests", "Build", "Evaluate", "Publish"], extras: ["Task budget"], fixRounds: 1, turns: 60, budgetUsd: 10 });
    expect(effortSummary("high")).toEqual({ stages: ["Plan", "Breakdown", "Contract", "Tests", "Build", "Evaluate", "Publish"], extras: ["Scout subagents", "Task budget"], fixRounds: 2, turns: 90, budgetUsd: 20 });
    expect(effortSummary("max")).toEqual({ stages: ["Plan", "Breakdown", "Contract", "Tests", "Build", "Evaluate", "Publish"], extras: ["Scout subagents", "Task budget", "Think tool", "Evaluator re-runs every criterion"], fixRounds: 3, turns: 120, budgetUsd: 40 });
  });
  it("supervisionSummary lists the pauses a level turns on, in pipeline order", () => {
    expect(supervisionSummary("unattended")).toEqual([]);
    expect(supervisionSummary("ask-to-publish")).toEqual(["before publishing each package"]);
    expect(supervisionSummary("check-in")).toEqual(["after the plan", "to approve each contract", "after each evaluation", "before each merge"]);
    expect(supervisionSummary("ask-every-write")).toEqual(["after the plan", "to approve each contract", "before each commit", "after each evaluation", "before publishing each package", "before each merge"]);
  });
});

