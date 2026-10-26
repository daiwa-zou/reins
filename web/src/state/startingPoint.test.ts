import { describe, expect, it } from "vitest";
import { generatedPresets } from "../../../shared/presets";
import type { Preset } from "../../../shared/types";
import { classifyPresets, describeStart, startingPointFor } from "./startingPoint";

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
