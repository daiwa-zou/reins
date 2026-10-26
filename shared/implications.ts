// One table, three views. Every typed implication links a lesson to a
// component, a stage, a skill or a foundation (or is a gap idea). From that
// single table this module derives:
//   - each component's and foundation's `lessons` list (the Harness section),
//   - the "Lessons for this stage" block in each phase's first message,
//   - the Ideas list (gaps, and anything not yet reviewed).
// Pure: the server, the web UI, the lessons:check script and vitest share it.
import type { ComponentId, Foundation, HarnessComponent, Implication, Lesson, LessonProblem, Phase, Standing } from "./types.js";
import { COMPONENTS, FOUNDATIONS } from "./components.js";

/** At most this many lines in one stage's "Lessons for this stage" block. */
export const STAGE_BLOCK_CAP = 8;

export const STAGE_PHASES: Phase[] = ["plan", "contract", "build", "evaluate", "wrapup"];

/** Only these may enter stage prompt blocks and presets. Unreviewed ones only show up as Ideas. */
export const isTrusted = (i: Pick<Implication, "standing">) => i.standing === "bundled" || i.standing === "reviewed";

export const allImplications = (lessons: Lesson[]): Implication[] => lessons.flatMap((l) => l.items ?? []);

/** Lesson slugs per target, in library order (newest lesson first). */
function slugsFor(lessons: Lesson[], kind: Implication["kind"], target: string): string[] {
  return [...new Set(allImplications(lessons).filter((i) => i.kind === kind && i.target === target).map((i) => i.lesson))];
}

/** Components and foundations with `lessons` derived from the implications that target them. */
export function linkCatalogue(lessons: Lesson[]): { components: HarnessComponent[]; foundations: Foundation[] } {
  return {
    components: COMPONENTS.map((c) => ({ ...c, lessons: slugsFor(lessons, "component", c.id) })),
    foundations: FOUNDATIONS.map((f) => ({ ...f, lessons: slugsFor(lessons, "foundation", f.id) })),
  };
}

/** Fill COMPONENTS[].lessons and FOUNDATIONS[].lessons in place (the server does this whenever the library loads). */
export function applyCatalogueLinks(lessons: Lesson[]): void {
  const linked = linkCatalogue(lessons);
  linked.components.forEach((c, i) => (COMPONENTS[i].lessons = c.lessons));
  linked.foundations.forEach((f, i) => (FOUNDATIONS[i].lessons = f.lessons));
}

/** lessons:check findings for the catalogue: components and foundations no implication targets. */
export function catalogueProblems(lessons: Lesson[]): LessonProblem[] {
  const out: LessonProblem[] = [];
  const { components, foundations } = linkCatalogue(lessons);
  for (const c of components) if (!c.lessons.length) out.push({ file: "catalogue", source: "catalogue", level: "warn", message: `component "${c.id}" is targeted by no implication; add a [component:${c.id}] bullet to the lesson that justifies it` });
  for (const f of foundations) if (!f.lessons.length) out.push({ file: "catalogue", source: "catalogue", level: "warn", message: `foundation "${f.id}" is targeted by no implication; add a [foundation:${f.id}] bullet` });
  // The tier is a claim a lesson should back: an always-on component needs a trusted (bundled or reviewed) implication.
  for (const c of COMPONENTS)
    if (c.tier === "always" && !lessons.some((l) => l.standing !== "unreviewed" && (l.items ?? []).some((i) => i.kind === "component" && i.target === c.id && i.standing !== "unreviewed")))
      out.push({ file: "catalogue", source: "catalogue", level: "warn", message: `component "${c.id}" is always on (always-tier) but no bundled or reviewed implication targets it; back the tier with a [component:${c.id}] bullet` });
  return out;
}

const standingRank: Record<Standing, number> = { reviewed: 0, bundled: 1, unreviewed: 2 };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!]+$/, "");

/** Order for stage blocks: reviewed before bundled, then newest lesson first, then file order. */
export function byStandingThenNewest(a: Implication, b: Implication): number {
  return standingRank[a.standing] - standingRank[b.standing] || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
}

/**
 * The trusted stage implications for one phase. An implication with no domain
 * tags always applies; a tagged one applies only when one of its domains was
 * picked. Deduplicated by claim, capped at STAGE_BLOCK_CAP.
 */
export function stageImplications(lessons: Lesson[], phase: Phase, domains: string[] = [], cap = STAGE_BLOCK_CAP): Implication[] {
  const picked = allImplications(lessons)
    .filter((i) => i.kind === "stage" && i.target === phase && isTrusted(i))
    .filter((i) => !i.domains.length || i.domains.some((d) => domains.includes(d)))
    .map((i, n) => ({ i, n }))
    .sort((a, b) => byStandingThenNewest(a.i, b.i) || a.n - b.n)
    .map((x) => x.i);
  const seen = new Set<string>();
  const out: Implication[] = [];
  for (const i of picked) {
    const k = norm(i.claim);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(i);
    if (out.length >= cap) break;
  }
  return out;
}

/** "Lessons for this stage" lines for every phase, as recorded on the run config. */
export function stageLessonsFor(lessons: Lesson[], domains: string[] = []): Partial<Record<Phase, string[]>> {
  const out: Partial<Record<Phase, string[]>> = {};
  for (const p of STAGE_PHASES) {
    const lines = stageImplications(lessons, p, domains).map((i) => `${i.claim} (${i.lesson})`);
    if (lines.length) out[p] = lines;
  }
  return out;
}

/** Render the block for a first message; lines are deduplicated and capped again in case a config was hand-edited. */
export function renderStageBlock(lines: string[] | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines ?? []) {
    if (typeof l !== "string" || !l.trim()) continue;
    const k = norm(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(`- ${l.trim()}`);
    if (out.length >= STAGE_BLOCK_CAP) break;
  }
  return out.join("\n");
}

/** Map a first-message phase label ("build (fix round 1)", "contract review") to its stage. */
export function phaseOfLabel(label: string): Phase | undefined {
  const w = label.trim().split(/\s+/)[0]?.toLowerCase();
  return (STAGE_PHASES as string[]).includes(w) ? (w as Phase) : undefined;
}

export interface Idea {
  lesson: string;
  lessonTitle: string;
  claim: string;
  quote: string;
  standing: Standing;
  kind: Implication["kind"];
  target?: string;
}

/** The Ideas list: every gap, plus any unreviewed implication (which may not enter prompts or presets yet). */
export function ideas(lessons: Lesson[]): Idea[] {
  const out: Idea[] = [];
  for (const l of lessons) for (const i of l.items ?? []) if (!i.implicit && (i.kind === "gap" || !isTrusted(i))) out.push({ lesson: l.slug, lessonTitle: l.title, claim: i.claim, quote: i.quote, standing: i.standing, kind: i.kind, ...(i.target ? { target: i.target } : {}) });
  return out;
}

/** Every domain a lesson or an implication names. */
export function namedDomains(lessons: Lesson[]): string[] {
  const out: string[] = [];
  for (const l of lessons) {
    for (const d of l.domains ?? []) if (!out.includes(d)) out.push(d);
    for (const i of l.items ?? []) for (const d of i.domains) if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** Does this lesson shape this domain (lesson-level domains:, or any implication tagged with it)? */
export function lessonInDomain(l: Lesson, domain: string): boolean {
  return !!l.domains?.includes(domain) || (l.items ?? []).some((i) => i.domains.includes(domain));
}

export type { ComponentId };
