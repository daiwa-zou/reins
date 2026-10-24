import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentId, Lesson } from "../../shared/types.js";
import { COMPONENTS, FOUNDATIONS } from "../../shared/components.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LESSONS_DIR = path.resolve(here, "../../lessons");

let cache: Lesson[] | null = null;

/**
 * Lessons are markdown files with a small frontmatter block:
 *   ---
 *   title: ...
 *   date: YYYY-MM-DD
 *   url: https://...
 *   tags: a, b
 *   takeaway: one paragraph
 *   ---
 *   ## Learnings
 *   - ...
 *   ## Harness implications
 *   - ...
 */
export function listLessons(): Lesson[] {
  if (cache) return cache;
  if (!fs.existsSync(LESSONS_DIR)) return (cache = []);
  const out: Lesson[] = [];
  for (const f of fs.readdirSync(LESSONS_DIR).filter((x) => x.endsWith(".md")).sort()) {
    const slug = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(LESSONS_DIR, f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) continue;
    const meta: Record<string, string> = {};
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const body = m[2];
    const section = (name: string) => {
      const re = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
      const s = body.match(re)?.[1] ?? "";
      return s
        .split("\n")
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => l.trim().slice(2).trim());
    };
    const components = COMPONENTS.filter((c) => c.lessons.includes(slug)).map((c) => c.id as ComponentId);
    const foundations = FOUNDATIONS.filter((f) => f.lessons.includes(slug)).map((f) => f.id);
    out.push({
      slug,
      title: meta.title ?? slug,
      date: meta.date ?? "",
      url: meta.url ?? "",
      takeaway: meta.takeaway ?? "",
      learnings: section("Learnings"),
      implications: section("Harness implications"),
      components,
      foundations,
      tags: (meta.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return (cache = out);
}

export function getLesson(slug: string): Lesson | undefined {
  return listLessons().find((l) => l.slug === slug);
}

export function invalidateLessons() {
  cache = null;
}
