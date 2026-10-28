import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteLesson, lessonDerived } from "./lessonAdmin.js";
import { getLesson, invalidateLessons, listLessons, LESSONS_DIR } from "./lessons.js";
import { domainsFile, listDomains, saveDomain } from "./domains.js";
import { listPresets, presetsFile, savePreset, setDefaultPreset } from "./presets.js";

const lessonMd = (title: string, n = 2) =>
  `---\ntitle: ${title}\ndate: 2026-01-01\nsource: note\nstanding: reviewed\ntakeaway: t\n---\n\n## Learnings\n- a b\n- c d\n\n## Harness implications\n${Array.from({ length: n }, (_, i) => `- [stage:build] Claim ${i + 1}.\n  > a b`).join("\n")}\n`;

describe("deleting a lesson removes what was derived from it", () => {
  let home: string;
  const prev = process.env.REINS_HOME;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "reins-del-"));
    process.env.REINS_HOME = home;
    const dir = path.join(home, "lessons");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "gone.md"), lessonMd("Gone"));
    fs.writeFileSync(path.join(dir, "stays.md"), lessonMd("Stays"));
    // The intake job that adopted "gone" (job slug differs from the lesson slug), plus one for "stays".
    for (const [job, lessonSlug] of [["gone-job", "gone"], ["stays-job", "stays"]] as const) {
      fs.mkdirSync(path.join(dir, job));
      fs.writeFileSync(path.join(dir, job, "job.json"), JSON.stringify({ id: `intake-${job}`, slug: job, status: "adopted", lessonSlug, createdAt: "2026-01-01" }));
      fs.writeFileSync(path.join(dir, job, "source.md"), "a b c d");
    }
    invalidateLessons();
    // Domains: one mixed, one built only from "gone", one untouched.
    saveDomain({ id: "mixed", label: "Mixed", implications: ["gone#1", "stays#1"] });
    saveDomain({ id: "only-gone", label: "Only gone", implications: ["gone#1", "gone#2"] });
    saveDomain({ id: "untouched", label: "Untouched", implications: ["stays#2"] });
    // Presets: one built on both lessons, one only on "gone" (and the default).
    savePreset({ name: "both", config: { effort: "medium", supervision: "check-in" }, lessons: ["gone", "stays"] });
    savePreset({ name: "onlygone", config: { effort: "low", supervision: "unattended" }, lessons: ["gone"] });
    setDefaultPreset("onlygone");
  });
  afterAll(() => {
    process.env.REINS_HOME = prev;
    invalidateLessons();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("previews exactly what goes, without changing anything", () => {
    const d = lessonDerived("gone");
    expect(d.file).toBe(path.join(home, "lessons", "gone.md"));
    expect(d.intakeJobs).toEqual([path.join(home, "lessons", "gone-job")]);
    expect(d.domains).toEqual([
      { id: "mixed", label: "Mixed", dropped: ["gone#1"], deleted: false },
      { id: "only-gone", label: "Only gone", dropped: ["gone#1", "gone#2"], deleted: true },
    ]);
    expect(d.presets).toEqual([
      { name: "both", deleted: false },
      { name: "onlygone", deleted: true },
    ]);
    expect(d.revealsBundled).toBe(false);
    // A preview is read-only.
    expect(fs.existsSync(d.file)).toBe(true);
    expect(listDomains().map((x) => x.id).sort()).toEqual(["mixed", "only-gone", "untouched"]);
    expect(listPresets().default).toBe("onlygone");
  });

  it("refuses bundled lessons and unknown slugs", () => {
    expect(() => lessonDerived("no-such-lesson")).toThrow(/no lesson/);
    const bundled = fs.readdirSync(LESSONS_DIR).filter((f) => f.endsWith(".md"));
    // The repo's bundled folder ships empty; a bundled lesson is simulated by a file there only if one exists.
    if (bundled.length) expect(() => deleteLesson(bundled[0].replace(/\.md$/, ""))).toThrow(/bundled/);
  });

  it("deletes the lesson, its intake folder, its implications in domains and its place in presets, and nothing else", () => {
    const d = deleteLesson("gone");
    expect(fs.existsSync(path.join(home, "lessons", "gone.md"))).toBe(false);
    expect(fs.existsSync(path.join(home, "lessons", "gone-job"))).toBe(false);
    expect(fs.existsSync(path.join(home, "lessons", "stays-job"))).toBe(true);
    expect(getLesson("gone")).toBeUndefined();
    expect(listLessons().map((l) => l.slug)).toEqual(["stays"]);
    expect(d.domains.map((x) => [x.id, x.deleted])).toEqual([
      ["mixed", false],
      ["only-gone", true],
    ]);
    const domains = Object.fromEntries(listDomains().map((x) => [x.id, x.implications]));
    expect(domains).toEqual({ mixed: ["stays#1"], untouched: ["stays#2"] });
    const presets = listPresets();
    const user = presets.presets.filter((p) => !p.builtIn && !p.generated);
    expect(user.map((p) => [p.name, p.lessons])).toEqual([["both", ["stays"]]]);
    // The deleted preset was the default; no default now rather than a dangling name.
    expect(presets.default).toBeNull();
    expect(JSON.parse(fs.readFileSync(presetsFile(), "utf8")).default).toBeNull();
    expect(JSON.parse(fs.readFileSync(domainsFile(), "utf8")).domains).toHaveLength(2);
    // Deleting again: it is gone.
    expect(() => deleteLesson("gone")).toThrow(/no lesson/);
  });
});
