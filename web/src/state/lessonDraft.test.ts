import { describe, expect, it } from "vitest";
import { dropImplication, editImplication, initLessonDraft, parseDomains, setDraftStanding, toLessonEdits } from "./lessonDraft";
import { compositionError, runPresetChip } from "./runChip";
import { presetsLabel } from "@shared/presets";

const payload = {
  slug: "x",
  title: "X",
  implications: [
    { kind: "stage" as const, target: "build", claim: "one", quote: "q1", domains: [] },
    { kind: "component" as const, target: "evaluator", claim: "two", quote: "q2", domains: ["web"] },
    { kind: "gap" as const, target: "", claim: "three", quote: "q3", domains: [] },
  ],
};

describe("lesson approval draft", () => {
  it("drops, edits and sets standing", () => {
    let s = initLessonDraft(payload);
    expect(s.standing).toBe("unreviewed");
    s = dropImplication(s, 1);
    s = editImplication(s, 0, { claim: "edited claim", domains: parseDomains("golang, CLI") });
    s = setDraftStanding(s, "reviewed");
    const e = toLessonEdits(s);
    expect(e.implications.map((i) => i.claim)).toEqual(["edited claim", "three"]);
    expect(e.implications.some((i) => i.claim === "two")).toBe(false);
    expect(e.implications[0].domains).toEqual(["golang", "cli"]);
    expect(e.standing).toBe("reviewed");
    // undo a drop
    expect(toLessonEdits(dropImplication(s, 1, false)).implications).toHaveLength(3);
  });
  it("bundled is never a user standing; gap clears its target", () => {
    expect(setDraftStanding(initLessonDraft(payload), "bundled").standing).toBe("unreviewed");
    expect(toLessonEdits(editImplication(initLessonDraft(payload), 0, { kind: "gap" })).implications[0].target).toBe("");
  });
});

describe("run preset chip", () => {
  it("labels composed runs, falls back to preset, names intake", () => {
    expect(presetsLabel(["careful", "golang", "cli"])).toBe("Careful · Go · CLI");
    expect(runPresetChip({ presets: ["careful", "golang", "cli"] })).toBe("Careful · Go · CLI");
    expect(runPresetChip({ effort: "high", supervision: "check-in", domains: ["golang", "cli"] })).toBe("High · Check in · Go · CLI");
    expect(runPresetChip({ effort: "high", supervision: "check-in", domains: [], ablated: ["compaction"] })).toBe("High · Check in · Experiment: without Compaction");
    expect(runPresetChip({ preset: "My preset" })).toBe("My preset");
    expect(runPresetChip({ job: "intake", presets: ["full"] })).toBe("Lesson intake");
    expect(runPresetChip({})).toBe("");
  });
  it("returns composition errors as strings without throwing", () => {
    expect(compositionError({ effort: "extreme" as any }, [])).toMatch(/unknown effort/);
    expect(compositionError({ supervision: "sometimes" as any }, [])).toMatch(/supervision/);
    expect(typeof compositionError({ effort: "high", domains: ["nosuchdomain"] }, [])).toBe("string");
    expect(compositionError({ effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] }, [])).toBeNull();
    expect(compositionError({}, [])).toBeNull();
  });
});
