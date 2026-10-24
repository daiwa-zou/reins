// Pure lesson parsing, validation and filtering. File I/O lives in
// server/src/lessons.ts; this module only sees strings, so vitest, the server,
// the lessons:check script and the agent tools share one parser.
import type { ComponentId, Lesson, LessonProblem } from "./types.js";
import { COMPONENTS, COMPONENT_IDS, FOUNDATIONS, GUIDANCE_MAX_CHARS } from "./components.js";

export type ParseProblem = Pick<LessonProblem, "level" | "message">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A lesson slug is a file name without .md: no slashes, no leading dot. */
export const LESSON_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return t;
}

const list = (v: string | undefined) =>
  (v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => unquote(x))
    .filter(Boolean);

/**
 * Parse one lesson file. Tolerates CRLF, a BOM and quoted values. Optional
 * `components:` / `foundations:` frontmatter lists are merged with the
 * catalogue mapping in shared/components.ts. Returns a lesson whenever the
 * frontmatter block exists, plus every problem found.
 */
export function parseLesson(slug: string, raw: string, source: Lesson["source"] = "bundled"): { lesson?: Lesson; problems: ParseProblem[] } {
  const problems: ParseProblem[] = [];
  const err = (message: string) => problems.push({ level: "error", message });
  const text = String(raw ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/);
  if (!m) {
    err("missing frontmatter: the file must start with a --- line, then title/date/takeaway lines, then a closing --- line");
    return { problems };
  }
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i <= 0) {
      problems.push({ level: "warn", message: `frontmatter line is not "key: value": ${line.trim().slice(0, 60)}` });
      continue;
    }
    meta[line.slice(0, i).trim().toLowerCase()] = unquote(line.slice(i + 1));
  }
  const body = m[2] ?? "";
  for (const k of ["title", "date", "takeaway"]) if (!meta[k]) err(`missing ${k} in the frontmatter`);
  if (meta.date && !DATE.test(meta.date)) err(`date "${meta.date}" is not YYYY-MM-DD`);

  const fmComponents: ComponentId[] = [];
  for (const id of list(meta.components)) {
    if ((COMPONENT_IDS as string[]).includes(id)) fmComponents.push(id as ComponentId);
    else err(`unknown component id "${id}" in components: (see docs/configuring.md for the ids)`);
  }
  const fmFoundations: string[] = [];
  for (const id of list(meta.foundations)) {
    if (FOUNDATIONS.some((f) => f.id === id)) fmFoundations.push(id);
    else err(`unknown foundation id "${id}" in foundations: (known: ${FOUNDATIONS.map((f) => f.id).join(", ")})`);
  }

  // Preset effects: which domains this lesson shapes, and how (see docs/lesson-template.md).
  const effectIds = (key: "enables" | "disables") => {
    const out: ComponentId[] = [];
    for (const id of list(meta[key])) {
      if ((COMPONENT_IDS as string[]).includes(id)) out.push(id as ComponentId);
      else err(`unknown component id "${id}" in ${key}: (see docs/configuring.md for the ids)`);
    }
    return [...new Set(out)];
  };
  const domains: string[] = [];
  for (const d of list(meta.domains)) {
    if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(d)) domains.push(d);
    else err(`invalid domain "${d}" in domains: (use lowercase letters, digits and -, e.g. web, cli)`);
  }
  const enables = effectIds("enables");
  const disables = effectIds("disables");
  for (const id of enables) if (disables.includes(id)) err(`component "${id}" is in both enables: and disables:`);
  const guidance = (meta.guidance ?? "").replace(/\s+/g, " ").trim();
  if (guidance.length > GUIDANCE_MAX_CHARS) err(`guidance: is ${guidance.length} characters; keep it to one line of at most ${GUIDANCE_MAX_CHARS}`);
  if (!domains.length && (enables.length || disables.length || guidance))
    problems.push({ level: "warn", message: "enables:/disables:/guidance: have no effect without domains: (e.g. domains: web)" });

  const section = (name: string) => {
    const re = new RegExp(`(?:^|\\n)##[ \\t]*${name}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|$)`, "i");
    return (body.match(re)?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- ") || l.startsWith("* "))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);
  };
  const learnings = section("Learnings");
  const implications = section("Harness implications");
  if (!learnings.length) err('empty or missing "## Learnings" section (add "- " bullets under it)');
  if (!implications.length) err('empty or missing "## Harness implications" section (add "- " bullets under it)');

  const components = [...new Set([...COMPONENTS.filter((c) => c.lessons.includes(slug)).map((c) => c.id), ...fmComponents])];
  const foundations = [...new Set([...FOUNDATIONS.filter((f) => f.lessons.includes(slug)).map((f) => f.id), ...fmFoundations])];
  return {
    lesson: {
      slug,
      title: meta.title || slug,
      date: meta.date ?? "",
      url: meta.url ?? "",
      takeaway: meta.takeaway ?? "",
      learnings,
      implications,
      components,
      foundations,
      tags: list(meta.tags),
      ...(domains.length ? { domains } : {}),
      ...(enables.length ? { enables } : {}),
      ...(disables.length ? { disables } : {}),
      ...(guidance ? { guidance: guidance.slice(0, GUIDANCE_MAX_CHARS) } : {}),
      source,
    },
    problems,
  };
}

/** Catalogue slugs (COMPONENTS[].lessons, FOUNDATIONS[].lessons) that resolve to no lesson file. */
export function danglingCatalogueSlugs(slugs: Iterable<string>): LessonProblem[] {
  const have = new Set(slugs);
  const out: LessonProblem[] = [];
  for (const c of [...COMPONENTS, ...FOUNDATIONS])
    for (const s of c.lessons) if (!have.has(s)) out.push({ file: "catalogue", source: "catalogue", level: "error", message: `${c.id} cites lesson "${s}", but there is no lessons/${s}.md` });
  return out;
}

// ---- Agent-facing filtering -----------------------------------------------

export interface LessonFilter {
  query?: string;
  tag?: string;
  component?: string;
}

export function filterLessons(lessons: Lesson[], f: LessonFilter = {}): Lesson[] {
  const q = f.query?.trim().toLowerCase();
  const tag = f.tag?.trim().toLowerCase();
  const comp = f.component?.trim().toLowerCase();
  return lessons.filter(
    (l) =>
      (!tag || l.tags.some((t) => t.toLowerCase() === tag)) &&
      (!comp || l.components.some((c) => c.toLowerCase() === comp) || l.foundations.some((x) => x.toLowerCase() === comp)) &&
      (!q || `${l.slug} ${l.title} ${l.takeaway} ${l.tags.join(" ")} ${l.learnings.join(" ")}`.toLowerCase().includes(q)),
  );
}

export const LESSON_LINE_MAX = 160;

/** `slug: title — short takeaway`, never longer than LESSON_LINE_MAX characters. */
export function lessonLine(l: Pick<Lesson, "slug" | "title" | "takeaway">): string {
  const head = `${l.slug}: ${l.title}`;
  const firstSentence = (l.takeaway.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? l.takeaway).trim();
  let line = firstSentence ? `${head} — ${firstSentence}` : head;
  if (line.length > LESSON_LINE_MAX) line = line.slice(0, LESSON_LINE_MAX - 1).trimEnd() + "…";
  return line;
}
