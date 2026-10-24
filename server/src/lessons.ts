import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Lesson, LessonProblem } from "../../shared/types.js";
import type { Standing } from "../../shared/types.js";
import { LESSON_SLUG, parseLesson } from "../../shared/lessons.js";
import { applyCatalogueLinks, catalogueProblems } from "../../shared/implications.js";
import { loadSkills } from "./skills.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LESSONS_DIR = path.resolve(here, "../../lessons");
/** Larger files are not lessons; refuse them rather than read them. */
const MAX_LESSON_BYTES = 512 * 1024;

/** The user's own library: $REINS_HOME/lessons (read at call time, so tests and the check script can point it elsewhere). */
export function userLessonsDir(): string {
  return path.join(process.env.REINS_HOME ?? path.join(os.homedir(), ".reins"), "lessons");
}

export interface LessonLibrary {
  lessons: Lesson[];
  problems: LessonProblem[];
  dirs: { bundled: string; user: string };
}

/**
 * Cache invalidation: a cheap stat signature of both directories (file names,
 * sizes and mtimes, plus the directory's own existence). Any added, removed or
 * edited .md file changes the signature, so the next call re-parses; a user
 * dir that did not exist at startup is picked up as soon as it appears.
 */
function signature(dir: string): string {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return "absent";
  }
  const parts = [];
  for (const f of names) {
    try {
      const full = path.join(dir, f);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        st = fs.lstatSync(full);
      }
      parts.push(`${f}:${st.size}:${st.mtimeMs}`);
    } catch {
      parts.push(`${f}:gone`);
    }
  }
  return parts.join("|");
}

let cache: { key: string; lib: LessonLibrary } | null = null;

function readDir(dir: string, source: Lesson["source"], problems: LessonProblem[], skills: string[]): Lesson[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return [];
  }
  const out: Lesson[] = [];
  for (const f of entries) {
    const slug = f.replace(/\.md$/, "");
    const problem = (level: LessonProblem["level"], message: string) => problems.push({ file: f, source, level, message });
    if (!LESSON_SLUG.test(slug)) {
      problem("error", "file name is not a valid slug (letters, digits, . _ - only, no leading dot); skipped");
      continue;
    }
    const full = path.join(dir, f);
    // Never follow a path out of the library directory (symlinks included).
    let real: string;
    try {
      real = fs.realpathSync(full);
    } catch {
      problem("error", "cannot be read (dangling symlink?); skipped");
      continue;
    }
    if (path.dirname(real) !== realDir && !real.startsWith(realDir + path.sep)) {
      problem("error", "is a symlink to a file outside the lessons directory; not read");
      continue;
    }
    const st = fs.statSync(real);
    if (!st.isFile()) {
      problem("error", "is not a regular file; skipped");
      continue;
    }
    if (st.size > MAX_LESSON_BYTES) {
      problem("error", `is ${st.size} bytes, over the ${MAX_LESSON_BYTES}-byte limit; skipped`);
      continue;
    }
    const { lesson, problems: ps } = parseLesson(slug, fs.readFileSync(real, "utf8"), source, { skills });
    for (const p of ps) problem(p.level, p.message);
    if (lesson) out.push(lesson);
  }
  return out;
}

/** The merged library: bundled lessons/ plus $REINS_HOME/lessons, where a user slug overrides the bundled one. */
export function loadLessonLibrary(): LessonLibrary {
  const dirs = { bundled: LESSONS_DIR, user: userLessonsDir() };
  const key = `${dirs.bundled}#${signature(dirs.bundled)}#${dirs.user}#${signature(dirs.user)}`;
  if (cache?.key === key) return cache.lib;
  const problems: LessonProblem[] = [];
  const bySlug = new Map<string, Lesson>();
  const skills = loadSkills(null).map((s) => s.name);
  for (const l of readDir(dirs.bundled, "bundled", problems, skills)) bySlug.set(l.slug, l);
  for (const l of readDir(dirs.user, "user", problems, skills)) bySlug.set(l.slug, l);
  const lessons = [...bySlug.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
  // One table, three views: component and foundation lesson lists come from the implications.
  applyCatalogueLinks(lessons);
  problems.push(...catalogueProblems(lessons));
  const lib = { lessons, problems, dirs };
  cache = { key, lib };
  return lib;
}

export function listLessons(): Lesson[] {
  return loadLessonLibrary().lessons;
}

export function lessonProblems(): LessonProblem[] {
  return loadLessonLibrary().problems;
}

/** Look up by slug in the merged library. A slug that is not a plain file name never matches. */
export function getLesson(slug: string): Lesson | undefined {
  if (typeof slug !== "string" || !LESSON_SLUG.test(slug)) return undefined;
  return listLessons().find((l) => l.slug === slug);
}

export function invalidateLessons() {
  cache = null;
}

/** Set `standing:` in a user lesson's frontmatter. Bundled lessons cannot be changed. */
export function setLessonStanding(slug: string, standing: Standing): Lesson {
  if (!["reviewed", "unreviewed"].includes(standing)) throw new Error('standing must be "reviewed" or "unreviewed"');
  const l = getLesson(slug);
  if (!l) throw new LessonNotFound(`no lesson "${slug}"`);
  if (l.source !== "user") throw new Error("bundled lessons always have standing bundled; only lessons in your library can be changed");
  const file = path.join(userLessonsDir(), `${slug}.md`);
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) throw new Error("the lesson has no frontmatter");
  const fm = /^standing:.*$/m.test(m[2]) ? m[2].replace(/^standing:.*$/m, `standing: ${standing}`) : `${m[2]}\nstanding: ${standing}`;
  fs.writeFileSync(file, raw.slice(0, m[1].length) + fm + raw.slice(m[1].length + m[2].length));
  invalidateLessons();
  return getLesson(slug)!;
}

/** Write a lesson file into the user library ($REINS_HOME/lessons/<slug>.md). Refuses to overwrite. */
export function writeUserLesson(slug: string, markdown: string): string {
  if (!LESSON_SLUG.test(slug)) throw new Error(`"${slug}" is not a valid lesson slug`);
  const dir = userLessonsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  fs.writeFileSync(file, markdown);
  invalidateLessons();
  return file;
}

export class LessonNotFound extends Error {}
