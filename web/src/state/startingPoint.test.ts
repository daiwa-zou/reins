import { describe, expect, it } from "vitest";
import { BUILT_IN_PRESETS } from "../../../shared/config";
import { generatedPresets } from "../../../shared/presets";
import type { Preset } from "../../../shared/types";
import { classifyPresets, describeStart, startingPointFor } from "./startingPoint";

const mine: Preset = { name: "mine", description: "", builtIn: false, config: {} };
const list = [...BUILT_IN_PRESETS, ...generatedPresets([]), mine];
const names = (ps: Preset[]) => ps.map((p) => p.name);

describe("classifyPresets", () => {
  const c = classifyPresets(list);
  it("built-in Full, Minimal and Careful become profiles", () => {
    expect(names(c.profiles)).toEqual(["Full", "Minimal", "Careful"]);
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
    expect(names([...c.profiles, ...c.domains])).not.toContain("Claude Code");
  });
});

describe("startingPointFor", () => {
  const opts = { saved: ["mine"] };
  it("Full -> profile full", () => expect(startingPointFor("Full", opts)).toEqual({ kind: "compose", presets: ["full"] }));
  it("Careful -> profile careful", () => expect(startingPointFor("Careful", opts)).toEqual({ kind: "compose", presets: ["careful"] }));
  it("'Web app' -> [full, web]", () => expect(startingPointFor("Web app", opts)).toEqual({ kind: "compose", presets: ["full", "web"] }));
  it("'CLI / tool' -> [full, cli]", () => expect(startingPointFor("CLI / tool", opts)).toEqual({ kind: "compose", presets: ["full", "cli"] }));
  it("'Claude Code' -> [full] on the claude-code engine", () => expect(startingPointFor("Claude Code", opts)).toEqual({ kind: "compose", presets: ["full"], engine: "claude-code" }));
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
    expect(startingPointFor("Careful · Go · CLI")).toEqual({ kind: "compose", presets: ["careful", "golang", "cli"] });
    expect(describeStart({ kind: "compose", presets: ["careful", "web"] })).toBe("Careful · Web");
  });
});
