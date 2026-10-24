import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseLesson } from "../../shared/lessons.js";
import { catalogueProblems } from "../../shared/implications.js";
import { getLesson, LESSONS_DIR, loadLessonLibrary } from "./lessons.js";

const GOOD = `---
title: "A good lesson: with a colon"
date: 2026-10-01
url: https://example.com/post
tags: context, tools
takeaway: Short takeaway. Second sentence.
---

## Learnings
- First learning.
- Second learning.

## Harness implications
- [component:thinkTool] Do the thing.
  > First learning.
`;

const errors = (raw: string, slug = "x") => parseLesson(slug, raw).problems.filter((p) => p.level === "error").map((p) => p.message);

describe("parseLesson", () => {
  it("parses a good file, unquoting values", () => {
    const { lesson, problems } = parseLesson("good", GOOD);
    expect(problems).toEqual([]);
    expect(lesson).toMatchObject({ slug: "good", title: "A good lesson: with a colon", date: "2026-10-01", tags: ["context", "tools"], learnings: ["First learning.", "Second learning."], implications: ["Do the thing."], source: "bundled" });
  });

  it("gives an identical lesson for CRLF line endings", () => {
    expect(parseLesson("good", GOOD.replace(/\n/g, "\r\n"))).toEqual(parseLesson("good", GOOD));
  });

  it("reports missing frontmatter and returns no lesson", () => {
    const r = parseLesson("x", "no frontmatter here\n");
    expect(r.lesson).toBeUndefined();
    expect(r.problems[0].message).toMatch(/missing frontmatter/);
  });

  it("reports missing title, date and takeaway", () => {
    const e = errors("---\nurl: u\n---\n## Learnings\n- a\n## Harness implications\n- b\n");
    expect(e).toEqual(expect.arrayContaining(["missing title in the frontmatter", "missing date in the frontmatter", "missing takeaway in the frontmatter"]));
  });

  it("reports a date that is not YYYY-MM-DD", () => {
    expect(errors(GOOD.replace("2026-10-01", "2025/1/1"))).toEqual(['date "2025/1/1" is not YYYY-MM-DD']);
  });

  it("reports an unknown component id", () => {
    const e = errors(GOOD.replace("tags:", "components: notAComponent\ntags:"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/unknown component id "notAComponent"/);
  });

  it("reports an unknown foundation id", () => {
    expect(errors(GOOD.replace("tags:", "foundations: nope\ntags:"))[0]).toMatch(/unknown foundation id "nope"/);
  });

  it("merges frontmatter components with the catalogue mapping", () => {
    const { lesson, problems } = parseLesson("my-note", GOOD.replace("tags:", "components: thinkTool, skills\nfoundations: eventLog\ntags:"));
    expect(problems).toEqual([]);
    expect(lesson!.components).toEqual(["thinkTool", "skills"]);
    expect(lesson!.foundations).toEqual(["eventLog"]);
    // A bundled slug keeps its catalogue components and gains the frontmatter ones.
    const merged = parseLesson("claude-think-tool", GOOD.replace("tags:", "components: skills\ntags:")).lesson!;
    expect(merged.components).toEqual(expect.arrayContaining(["thinkTool", "skills"]));
  });

  it("reports empty Learnings and Harness implications sections", () => {
    const e = errors(GOOD.replace("- First learning.\n- Second learning.\n", "").replace("- [component:thinkTool] Do the thing.\n  > First learning.\n", ""));
    expect(e.join(" ")).toMatch(/Learnings/);
    expect(e.join(" ")).toMatch(/Harness implications/);
  });
});

describe("lesson library", () => {
  it("bundled library lints clean", () => {
    const slugs: string[] = [];
    const errs: string[] = [];
    for (const f of fs.readdirSync(LESSONS_DIR).filter((x) => x.endsWith(".md"))) {
      const slug = f.replace(/\.md$/, "");
      slugs.push(slug);
      for (const p of parseLesson(slug, fs.readFileSync(path.join(LESSONS_DIR, f), "utf8")).problems) errs.push(`${f} [${p.level}]: ${p.message}`);
    }
    // Untyped bullets are valid (kind gap) but warned about; errors are not allowed anywhere.
    expect(errs.filter((e) => e.includes("[error]"))).toEqual([]);
    // The five worked examples are fully typed, with every quote found in their Learnings.
    const worked = ["claude-code-best-practices", "demystifying-evals-for-ai-agents", "writing-tools-for-agents", "harness-design-long-running-apps", "effective-harnesses-for-long-running-agents"];
    expect(errs.filter((e) => worked.some((w) => e.startsWith(`${w}.md`)))).toEqual([]);
    expect(catalogueProblems(loadLessonLibrary().lessons)).toEqual([]);
    expect(slugs.length).toBeGreaterThanOrEqual(30);
  });

  it("flags a component no implication targets", () => {
    const d = catalogueProblems([]);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]).toMatchObject({ file: "catalogue", level: "warn" });
  });
});

describe("user lessons ($REINS_HOME/lessons)", () => {
  let home: string;
  const prev = process.env.REINS_HOME;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "reins-lessons-"));
    process.env.REINS_HOME = home;
  });
  afterEach(() => {
    process.env.REINS_HOME = prev;
    if (prev === undefined) delete process.env.REINS_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("picks up a lessons dir created after the first load, overrides by slug, reports problems, and never follows symlinks out", () => {
    const before = loadLessonLibrary().lessons.length;
    const dir = path.join(home, "lessons");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "my-note.md"), GOOD.replace("A good lesson: with a colon", "My note"));
    let lib = loadLessonLibrary();
    expect(lib.lessons.length).toBe(before + 1);
    expect(lib.lessons.find((l) => l.slug === "my-note")).toMatchObject({ title: "My note", source: "user" });

    const bundled = fs.readFileSync(path.join(LESSONS_DIR, "agent-skills.md"), "utf8");
    fs.writeFileSync(path.join(dir, "agent-skills.md"), bundled.replace(/^title: .*$/m, "title: My skills override"));
    fs.writeFileSync(path.join(dir, "broken.md"), "junk");
    const outside = path.join(home, "secret.md");
    fs.writeFileSync(outside, GOOD.replace("First learning.", "SECRET CONTENT"));
    fs.symlinkSync(outside, path.join(dir, "escape.md"));
    lib = loadLessonLibrary();
    const skills = lib.lessons.filter((l) => l.slug === "agent-skills");
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ title: "My skills override", source: "user" });
    expect(lib.problems.find((p) => p.file === "broken.md")?.message).toMatch(/missing frontmatter/);
    expect(lib.problems.find((p) => p.file === "escape.md")?.message).toMatch(/outside the lessons directory/);
    expect(JSON.stringify(lib.lessons)).not.toContain("SECRET CONTENT");
    expect(getLesson("escape")).toBeUndefined();
    expect(getLesson("../../etc/hosts")).toBeUndefined();
    expect(getLesson("my-note")?.source).toBe("user");
  });
});

describe("inline domains", () => {
  it("reads 'domains: a, b' right after the prefix as tags, not claim text", () => {
    const raw = "---\ntitle: T\ndate: 2026-01-01\ntakeaway: x\n---\n\n## Learnings\n- Run the linter.\n\n## Harness implications\n- [stage:build] domains: web, cli Always run the linter.\n  > Run the linter.\n";
    const { lesson } = parseLesson("inl", raw);
    const i = lesson!.items.find((x) => x.kind === "stage")!;
    expect(i.claim).toBe("Always run the linter.");
    expect(i.domains).toEqual(["web", "cli"]);
  });
});
