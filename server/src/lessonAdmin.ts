// Lesson management: what hangs off a lesson in your library, and deleting it
// together with all of that. Kept apart from lessons.ts because domains and
// presets read the library, and this reads them.
import fs from "node:fs";
import path from "node:path";
import { LESSON_SLUG } from "../../shared/lessons.js";
import { pruneLessonFromDomains, type DomainPrune } from "./domains.js";
import { pruneLessonFromPresets, type PresetPrune } from "./presets.js";
import { getLesson, invalidateLessons, LESSONS_DIR, LessonNotFound, userLessonsDir } from "./lessons.js";

/** Everything that hangs off a lesson in your library: what deleting it removes as well. */
export interface LessonDerived {
  slug: string;
  file: string;
  /** Intake job folders ($REINS_HOME/lessons/<job>/: source, draft, events) that produced this lesson. */
  intakeJobs: string[];
  domains: DomainPrune[];
  presets: PresetPrune[];
  /** A bundled lesson of the same slug that this one overrides, and that shows again once it is gone. */
  revealsBundled: boolean;
}

/** The intake job folders whose adopted lesson is `slug` (or that are named after it). */
function intakeJobDirsFor(slug: string): string[] {
  const dir = userLessonsDir();
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const d = path.join(dir, n);
    if (!LESSON_SLUG.test(n) || !fs.statSync(d).isDirectory()) continue;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(d, "job.json"), "utf8")) as { lessonSlug?: string; lessonFile?: string };
      const adopted = job.lessonSlug ?? (job.lessonFile ? path.basename(job.lessonFile).replace(/\.md$/, "") : undefined);
      if (adopted === slug || (!adopted && n === slug)) out.push(d);
    } catch {
      if (n === slug && fs.existsSync(path.join(d, "source.md"))) out.push(d);
    }
  }
  return out;
}

/** What deleting `slug` would remove. Throws LessonNotFound, or an Error for a bundled lesson. */
export function lessonDerived(slug: string): LessonDerived {
  const l = getLesson(slug);
  if (!l) throw new LessonNotFound(`no lesson "${slug}"`);
  if (l.source !== "user") throw new Error("bundled lessons ship with Reins and cannot be deleted; only lessons in your library can");
  const bundled = path.join(LESSONS_DIR, `${slug}.md`);
  return {
    slug,
    file: path.join(userLessonsDir(), `${slug}.md`),
    intakeJobs: intakeJobDirsFor(slug),
    domains: pruneLessonFromDomains(slug, true),
    presets: pruneLessonFromPresets(slug, true),
    revealsBundled: fs.existsSync(bundled),
  };
}

/**
 * Delete a lesson from your library together with what was derived from it:
 * its intake job folder(s), its implications in your domains (a domain built
 * only from it goes too) and its place in presets built on it. Generated
 * presets and stage blocks are recomputed from the library, so they follow on
 * their own; runs keep the stage lessons they were created with.
 */
export function deleteLesson(slug: string): LessonDerived {
  const d = lessonDerived(slug);
  fs.rmSync(d.file, { force: true });
  for (const dir of d.intakeJobs) fs.rmSync(dir, { recursive: true, force: true });
  invalidateLessons();
  d.domains = pruneLessonFromDomains(slug);
  d.presets = pruneLessonFromPresets(slug);
  return d;
}
