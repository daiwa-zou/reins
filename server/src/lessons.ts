import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Lesson, LessonProblem, Standing } from "../../shared/types.js";
import { LESSON_SLUG, parseLesson } from "../../shared/lessons.js";
import { applyCatalogueLinks } from "../../shared/implications.js";
import { loadSkills } from "./skills.js";
import { reinsHome } from "./store/runStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LESSONS_DIR = path.resolve(here, "../../lessons");
/** The example library (the 30 distilled posts), not loaded by default: `npm run lessons:examples` copies it into $REINS_HOME/lessons. */
export const EXAMPLES_DIR = path.resolve(here, "../../examples/lessons");
/** Larger files are not lessons; refuse them rather than read them. */
const MAX_LESSON_BYTES = 512 * 1024;

/** The user's own library: $REINS_HOME/lessons (read at call time, so tests and the check script can point it elsewhere). */
export function userLessonsDir(): string {
  return path.join(reinsHome(), "lessons");
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

/**
 * Intake sources for adopted user lessons: lesson slug -> source.md path. An intake job lives in
 * $REINS_HOME/lessons/<job-slug>/ and its job.json names the lesson file it wrote, whose slug may differ.
 */
function intakeSources(dir: string, realDir: string): Map<string, string> {
  const out = new Map<string, string>();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!LESSON_SLUG.test(n)) continue;
    const src = path.join(dir, n, "source.md");
    try {
      const job = JSON.parse(fs.readFileSync(path.join(dir, n, "job.json"), "utf8")) as { status?: string; lessonSlug?: string; lessonFile?: string };
      const slug = job.lessonSlug ?? (job.lessonFile ? path.basename(job.lessonFile).replace(/\.md$/, "") : undefined);
      if (job.status === "adopted" && slug && fs.existsSync(src)) out.set(slug, src);
    } catch {
      /* not an intake job dir */
    }
    if (!out.has(n) && fs.existsSync(src)) out.set(n, src);
  }
  for (const [slug, src] of out) {
    try {
      const real = fs.realpathSync(src);
      if (!real.startsWith(realDir + path.sep)) out.delete(slug);
    } catch {
      out.delete(slug);
    }
  }
  return out;
}

/** The intake source.md text for a user lesson, size-capped, or undefined. */
function readIntakeSource(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 400_000) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

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
  const sources = source === "user" ? intakeSources(dir, realDir) : new Map<string, string>();
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
    if (!real.startsWith(realDir + path.sep)) {
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
    // A lesson adopted from intake keeps its source next to it ($REINS_HOME/lessons/<slug>/source.md);
    // its quotes come from there, so check them against it as well as the Learnings.
    const sourceText = readIntakeSource(sources.get(slug));
    const { lesson, problems: ps } = parseLesson(slug, fs.readFileSync(real, "utf8"), source, { skills, ...(sourceText ? { sourceText } : {}) });
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
  const lib = { lessons, problems, dirs };
  cache = { key, lib };
  return lib;
}

/** Lint one directory of lessons as if it were the bundled dir (used by `lessons:check --examples`). */
export function lintDir(dir: string): LessonLibrary {
  const problems: LessonProblem[] = [];
  const lessons = readDir(dir, "bundled", problems, loadSkills(null).map((s) => s.name));
  return { lessons, problems, dirs: { bundled: dir, user: userLessonsDir() } };
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
