// Pure lesson parsing, validation and filtering. File I/O lives in
// server/src/lessons.ts; this module only sees strings, so vitest, the server,
// the lessons:check script and the agent tools share one parser.
import type { ComponentId, Implication, ImplicationKind, Lesson, LessonProblem, LessonProvenance, Phase, Standing } from "./types.js";
import { COMPONENTS, COMPONENT_IDS, EFFORT_LEVELS, FOUNDATIONS, GUIDANCE_MAX_CHARS, tierOf } from "./components.js";
import { DOMAIN_ID as DOMAIN } from "./domains.js";

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
export const IMPLICATION_KINDS: ImplicationKind[] = ["component", "stage", "skill", "foundation", "gap", "effort"];
export const PHASES: Phase[] = ["plan", "breakdown", "contract", "tests", "build", "evaluate", "publish", "wrapup"];
export const STANDINGS: Standing[] = ["bundled", "reviewed", "unreviewed"];
export const PROVENANCES: LessonProvenance[] = ["post", "article", "paper", "postmortem", "note", "repo", "mcp"];
export const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface ParseOptions {
  /** Known skill names; when given, a [skill:x] target that is not in it is an error. */
  skills?: string[];
  /** The source text quotes may come from (intake: source.md). A quote found in the lesson's own Learnings is always accepted. */
  sourceText?: string;
}

/** Whitespace- and quote-style-insensitive form used to check that a quote appears in a source. */
export function normalizeForQuote(s: string): string {
  return String(s ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Does `quote` appear verbatim (modulo whitespace and curly quotes) in `source`? */
export function quoteInSource(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(source).includes(q);
}

/**
 * Parse the "## Harness implications" section into raw bullets. A bullet is a
 * "- " line; indented lines below it continue it: "> quote" lines are the
 * evidence, a "domains: a, b" line tags it, anything else extends the claim.
 */
function implicationBullets(body: string): { head: string; quote: string; domains: string | undefined }[] {
  const re = /(?:^|\n)##[ \t]*Harness implications[ \t]*\n([\s\S]*?)(?=\n##[ \t]|$)/i;
  const lines = (body.match(re)?.[1] ?? "").split("\n");
  const out: { head: string; quote: string; domains: string | undefined }[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^[-*] /.test(t) && !/^\s/.test(line)) {
      out.push({ head: t.slice(2).trim(), quote: "", domains: undefined });
      continue;
    }
    const cur = out[out.length - 1];
    if (!cur) continue;
    if (t.startsWith(">")) cur.quote = (cur.quote ? cur.quote + " " : "") + t.replace(/^>\s?/, "");
    else if (/^domains:/i.test(t)) cur.domains = t.slice(t.indexOf(":") + 1);
    else if (/^[-*] /.test(t)) out.push({ head: t.slice(2).trim(), quote: "", domains: undefined });
    else cur.head += " " + t;
  }
  return out.filter((b) => b.head);
}

/** The typed prefix of a bullet: "[stage:evaluate] Claim." -> kind, target, claim. */
export function parseImplicationHead(head: string): { kind?: string; target?: string; claim: string; typed: boolean } {
  const m = head.match(/^\[\s*([A-Za-z]+)\s*(?::\s*([^\]\s]+)\s*)?\]\s*(.*)$/);
  if (!m) return { claim: head, typed: false };
  return { kind: m[1].toLowerCase(), target: m[2], claim: m[3].trim(), typed: true };
}

/**
 * Inline domains right after the prefix: "[stage:build] domains: web, cli Claim."
 * The list is comma-separated and ends at the first tag without a trailing comma
 * (or at ";" / "|"). Same meaning as an indented "domains:" line.
 */
export function splitInlineDomains(claim: string): { claim: string; domains?: string } {
  const m = claim.match(/^domains:\s*((?:[a-z0-9][a-z0-9-]*\s*,\s*)*[a-z0-9][a-z0-9-]*)\s*[;|]?\s+(.*)$/i);
  if (!m) return { claim };
  return { claim: m[2].trim(), domains: m[1] };
}

/** Render one implication back to the bullet syntax (used by intake drafts and adoption). */
export function renderImplication(i: Pick<Implication, "kind" | "target" | "claim" | "quote" | "domains">, lessonDomains: string[] = []): string {
  const own = i.domains.filter((d) => !lessonDomains.includes(d));
  const head = `- [${i.kind}${i.kind !== "gap" && i.target ? `:${i.target}` : ""}] ${i.claim.replace(/\s+/g, " ").trim()}`;
  return [head, ...(own.length ? [`  domains: ${own.join(", ")}`] : []), ...(i.quote ? [`  > ${i.quote.replace(/\s+/g, " ").trim()}`] : [])].join("\n");
}

export function parseLesson(slug: string, raw: string, source: Lesson["source"] = "bundled", opts: ParseOptions = {}): { lesson?: Lesson; problems: ParseProblem[] } {
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
      if ((COMPONENT_IDS as string[]).includes(id)) {
        out.push(id as ComponentId);
        if (tierOf(id) === "always") problems.push({ level: "warn", message: `${key}: names "${id}", which is always on (always-tier); composition ignores it` });
      }
      else err(`unknown component id "${id}" in ${key}: (see docs/configuring.md for the ids)`);
    }
    return [...new Set(out)];
  };
  const domains: string[] = [];
  for (const d of list(meta.domains)) {
    if (DOMAIN.test(d)) domains.push(d);
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
  const bullets = implicationBullets(body);
  if (!learnings.length) err('empty or missing "## Learnings" section (add "- " bullets under it)');
  if (!bullets.length) err('empty or missing "## Harness implications" section (add "- " bullets under it)');

  // Provenance and standing. Bundled lessons are always "bundled"; user lessons default to "unreviewed".
  const provenance = meta.source ? (meta.source.toLowerCase() as LessonProvenance) : undefined;
  if (provenance && !PROVENANCES.includes(provenance)) err(`source "${meta.source}" is not one of ${PROVENANCES.join(", ")}`);
  let standing: Standing = source === "bundled" ? "bundled" : "unreviewed";
  if (meta.standing) {
    const st = meta.standing.toLowerCase() as Standing;
    if (!STANDINGS.includes(st)) err(`standing "${meta.standing}" is not one of ${STANDINGS.join(", ")}`);
    else if (source === "user" && st === "bundled") problems.push({ level: "warn", message: 'standing: bundled is reserved for lessons shipped with Reins; treated as "reviewed"' });
    else if (source === "user") standing = st;
  }
  const learningsText = learnings.join("\n");
  const quoteFound = (q: string) => quoteInSource(q, learningsText) || (!!opts.sourceText && quoteInSource(q, opts.sourceText));

  const items: Implication[] = [];
  const untyped: number[] = [];
  bullets.forEach((b, n) => {
    const where = `implication ${n + 1}`;
    const h = parseImplicationHead(b.head);
    let kind: ImplicationKind = "gap";
    let target: string | undefined;
    if (!h.typed) untyped.push(n + 1);
    else if (!(IMPLICATION_KINDS as string[]).includes(h.kind!)) {
      err(`${where}: unknown kind "${h.kind}" (use ${IMPLICATION_KINDS.join(", ")})`);
      return;
    } else {
      kind = h.kind as ImplicationKind;
      target = h.target;
      if (kind === "gap" && target) err(`${where}: a gap has no target ([gap], not [gap:${target}])`);
      if (kind !== "gap") {
        if (!target) err(`${where}: [${kind}] needs a target, e.g. [${kind}:${kind === "stage" ? "build" : kind === "component" ? "evaluator" : kind === "skill" ? "verify-like-a-user" : kind === "effort" ? "high" : "eventLog"}]`);
        else if (kind === "effort" && !(EFFORT_LEVELS as string[]).includes(target)) err(`${where}: unknown effort level "${target}" (use ${EFFORT_LEVELS.join(", ")})`);
        else if (kind === "component" && !(COMPONENT_IDS as string[]).includes(target)) err(`${where}: unknown component id "${target}" (see docs/configuring.md for the ids)`);
        else if (kind === "stage" && !(PHASES as string[]).includes(target)) err(`${where}: unknown stage "${target}" (use ${PHASES.join(", ")})`);
        else if (kind === "foundation" && !FOUNDATIONS.some((f) => f.id === target)) err(`${where}: unknown foundation id "${target}" (known: ${FOUNDATIONS.map((f) => f.id).join(", ")})`);
        else if (kind === "skill" && (!SKILL_NAME.test(target) || (opts.skills && !opts.skills.includes(target)))) err(`${where}: unknown skill "${target}"${opts.skills ? ` (known: ${opts.skills.join(", ")})` : ""}`);
      }
    }
    const inline = splitInlineDomains(h.claim);
    if (inline.domains !== undefined) {
      h.claim = inline.claim;
      b.domains = b.domains ? `${b.domains}, ${inline.domains}` : inline.domains;
    }
    const own: string[] = [];
    for (const d of list(b.domains)) {
      if (DOMAIN.test(d)) own.push(d);
      else err(`${where}: invalid domain "${d}" (use lowercase letters, digits and -)`);
    }
    if (h.typed && !b.quote) problems.push({ level: "warn", message: `${where} has no "> quote" line with evidence from the source` });
    else if (b.quote && !quoteFound(b.quote)) problems.push({ level: "warn", message: `${where}: the quote is not found verbatim in the ${opts.sourceText ? "source or the Learnings" : "Learnings"}: "${b.quote.slice(0, 60)}"` });
    items.push({ id: `${slug}#${n + 1}`, lesson: slug, date: meta.date ?? "", kind, ...(target && kind !== "gap" ? { target } : {}), claim: h.claim || b.head, quote: b.quote, domains: [...new Set([...own, ...domains])], standing });
  });
  if (untyped.length)
    problems.push({ level: "warn", message: `${untyped.length} of ${bullets.length} implication${bullets.length === 1 ? "" : "s"} (${untyped.join(", ")}) have no [kind:target] prefix, so they are treated as gap ideas (see docs/lesson-template.md)` });
  // Frontmatter components:/foundations: are implicit implications (the claim is the takeaway).
  const claimed = (k: ImplicationKind, t: string) => items.some((i) => i.kind === k && i.target === t);
  const summary = (meta.takeaway ?? "").match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0]?.trim() || meta.takeaway || "";
  for (const id of fmComponents) if (!claimed("component", id)) items.push({ id: `${slug}#c-${id}`, lesson: slug, date: meta.date ?? "", kind: "component", target: id, claim: summary, quote: "", domains: [...domains], standing, implicit: true });
  for (const id of fmFoundations) if (!claimed("foundation", id)) items.push({ id: `${slug}#f-${id}`, lesson: slug, date: meta.date ?? "", kind: "foundation", target: id, claim: summary, quote: "", domains: [...domains], standing, implicit: true });

  const components = [...new Set(items.filter((i) => i.kind === "component").map((i) => i.target as ComponentId))];
  const foundations = [...new Set(items.filter((i) => i.kind === "foundation").map((i) => i.target as string))];
  return {
    lesson: {
      slug,
      title: meta.title || slug,
      date: meta.date ?? "",
      url: meta.url ?? "",
      takeaway: meta.takeaway ?? "",
      learnings,
      implications: items.filter((i) => !i.implicit).map((i) => i.claim),
      components,
      foundations,
      tags: list(meta.tags),
      ...(domains.length ? { domains } : {}),
      ...(enables.length ? { enables } : {}),
      ...(disables.length ? { disables } : {}),
      ...(guidance ? { guidance: guidance.slice(0, GUIDANCE_MAX_CHARS) } : {}),
      source,
      items,
      ...(provenance && PROVENANCES.includes(provenance) ? { provenance } : {}),
      standing,
      ...(meta.hash && /^[a-f0-9]{64}$/.test(meta.hash) ? { hash: meta.hash } : {}),
      ...(meta.focus?.trim() ? { focus: meta.focus.replace(/\s+/g, " ").trim() } : {}),
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
