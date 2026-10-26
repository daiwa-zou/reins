import { describe, expect, it } from "vitest";
import type { Implication, Lesson } from "../../../shared/types";
import { draftFor, filterImplications, pickable } from "./domainBuilder";

const impl = (lesson: string, n: number, kind: Implication["kind"], target: string | undefined, claim: string, extra: Partial<Implication> = {}): Implication => ({ id: `${lesson}#${n}`, lesson, date: "2026-01-01", kind, target, claim, quote: "q", domains: [], standing: "bundled", ...extra });
const lesson = (slug: string, items: Implication[], extra: Partial<Lesson> = {}): Lesson => ({ slug, title: `Lesson ${slug}`, date: "2026-01-01", url: "", takeaway: "t", learnings: ["l"], implications: items.map((i) => i.claim), components: [], foundations: [], tags: [], source: "bundled", items, standing: "bundled", ...extra });

const a = lesson("alpha", [impl("alpha", 1, "stage", "build", "Run the smoke test first.", { domains: ["web"] }), impl("alpha", 2, "component", "thinkTool", "Think before deleting."), impl("alpha", 3, "component", "planner", "Plan first.", { implicit: true })]);
const b = lesson("beta", [impl("beta", 1, "foundation", "eventLog", "Append only."), impl("beta", 2, "stage", "evaluate", "Check the real output.", { standing: "unreviewed" })], { source: "user", standing: "unreviewed" });

describe("the domain builder's pick list", () => {
  it("offers only trusted, explicit implications, with their lesson title", () => {
    expect(pickable([a, b]).map((p) => [p.id, p.lessonTitle])).toEqual([
      ["alpha#1", "Lesson alpha"],
      ["alpha#2", "Lesson alpha"],
      ["beta#1", "Lesson beta"],
    ]);
  });
  it("filters by text (claim, target, lesson), by kind, by lesson, and by 'picked only'", () => {
    const all = pickable([a, b]);
    expect(filterImplications(all, { q: "smoke" }).map((p) => p.id)).toEqual(["alpha#1"]);
    expect(filterImplications(all, { q: "THINKTOOL" }).map((p) => p.id)).toEqual(["alpha#2"]);
    expect(filterImplications(all, { q: "lesson beta" }).map((p) => p.id)).toEqual(["beta#1"]);
    expect(filterImplications(all, { kind: "stage" }).map((p) => p.id)).toEqual(["alpha#1"]);
    expect(filterImplications(all, { lesson: "beta" }).map((p) => p.id)).toEqual(["beta#1"]);
    expect(filterImplications(all, { picked: new Set(["beta#1", "alpha#2"]), pickedOnly: true }).map((p) => p.id)).toEqual(["alpha#2", "beta#1"]);
    expect(filterImplications(all, {})).toHaveLength(3);
  });
  it("starts a draft empty, from an existing domain, or from one lesson's trusted implications", () => {
    expect(draftFor()).toEqual({ id: "", label: "", description: "", implications: [] });
    expect(draftFor({ id: "x", label: "X", description: "d", implications: ["alpha#1"], createdAt: "t" })).toEqual({ id: "x", label: "X", description: "d", implications: ["alpha#1"] });
    expect(draftFor(undefined, a)).toEqual({ id: "", label: "", description: "", implications: ["alpha#1", "alpha#2"] });
  });
});
