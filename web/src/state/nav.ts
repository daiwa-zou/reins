/**
 * Navigation model. Pure: no React, no DOM, no storage, so it runs under
 * vitest's node environment and is the single source of truth for
 *  - the two-level information architecture (app sections, then views of the selected run),
 *  - how that state is written to and read from the URL query string,
 *  - the keyboard shortcuts (App binds them, Help lists them).
 */

import { COMPONENT_IDS, FOUNDATIONS } from "@shared/components";
import { LESSON_SLUG, SKILL_NAME } from "@shared/lessons";

export type Section = "runs" | "reliability" | "harness" | "lessons";
export type RunView = "activity" | "contract" | "changes" | "details";
export type DetailsSub = "transcript" | "context" | "guardrails";

export interface NavState {
  section: Section;
  /** Selected run id, or null. A run stays selected while another section is open. */
  run: string | null;
  view: RunView;
  sub: DetailsSub;
  /** Lessons section: the open lesson's slug. Absent = the list. */
  lesson?: string | null;
  /** Lessons section: component/foundation filter. Harness section: the card to focus. */
  component?: string | null;
  /** Harness section: the installed skill row to focus (a lesson's skill implication links here). */
  skill?: string | null;
}

export const SECTIONS: readonly { id: Section; label: string; hint: string }[] = [
  { id: "runs", label: "Runs", hint: "Watch and steer runs" },
  { id: "harness", label: "Start", hint: "Start a run from Effort, Supervision and domains; saved presets and installed skills" },
  { id: "lessons", label: "Lessons", hint: "The library behind the harness, and your domains" },
  { id: "reliability", label: "Trials", hint: "Repeat a task and see how often it passes" },
];

export const RUN_VIEWS: readonly { id: RunView; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "contract", label: "Contract" },
  { id: "changes", label: "Changes" },
  { id: "details", label: "Details" },
];

export const DETAILS_SUBS: readonly { id: DetailsSub; label: string }[] = [
  { id: "transcript", label: "Transcript" },
  { id: "context", label: "Context" },
  { id: "guardrails", label: "Guardrails" },
];

export const DEFAULT_NAV: NavState = { section: "runs", run: null, view: "activity", sub: "transcript" };

const isSection = (v: unknown): v is Section => SECTIONS.some((s) => s.id === v);
const isView = (v: unknown): v is RunView => RUN_VIEWS.some((s) => s.id === v);
const isSub = (v: unknown): v is DetailsSub => DETAILS_SUBS.some((s) => s.id === v);
/** Run ids are short nanoids; anything else in the URL is garbage. */
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Canonical form: view and sub only mean something for a selected run, and
 * sub only for the Details view. Everything else collapses to defaults.
 */
const COMPONENT_OR_FOUNDATION = new Set<string>([...COMPONENT_IDS, ...FOUNDATIONS.map((f) => f.id)]);

export function normalizeNav(s: Partial<NavState>): NavState {
  const run = typeof s.run === "string" && RUN_ID.test(s.run) ? s.run : null;
  const section = isSection(s.section) ? s.section : DEFAULT_NAV.section;
  const view = run && isView(s.view) ? s.view : DEFAULT_NAV.view;
  const sub = run && view === "details" && isSub(s.sub) ? s.sub : DEFAULT_NAV.sub;
  // Lesson and component only mean something in their sections; garbage is dropped, never thrown.
  const lesson = section === "lessons" && typeof s.lesson === "string" && LESSON_SLUG.test(s.lesson) ? s.lesson : undefined;
  const component = (section === "lessons" || section === "harness") && typeof s.component === "string" && COMPONENT_OR_FOUNDATION.has(s.component) ? s.component : undefined;
  const skill = section === "harness" && typeof s.skill === "string" && SKILL_NAME.test(s.skill) ? s.skill : undefined;
  return { section, run, view, sub, ...(lesson ? { lesson } : {}), ...(component ? { component } : {}), ...(skill ? { skill } : {}) };
}

/** Query string for a nav state ("" for the defaults). Default values are omitted. */
export function encodeNav(state: Partial<NavState>): string {
  const s = normalizeNav(state);
  const p = new URLSearchParams();
  if (s.section !== DEFAULT_NAV.section) p.set("section", s.section);
  if (s.run) p.set("run", s.run);
  if (s.view !== DEFAULT_NAV.view) p.set("view", s.view);
  if (s.sub !== DEFAULT_NAV.sub) p.set("sub", s.sub);
  if (s.lesson) p.set("lesson", s.lesson);
  if (s.component) p.set("component", s.component);
  if (s.skill) p.set("skill", s.skill);
  const q = p.toString();
  return q ? `?${q}` : "";
}

/**
 * Read a nav state from a query string. Never throws: unknown or empty values
 * fall back to defaults, and a run that `runExists` rejects is dropped.
 * Legacy links (`?run=<id>` only) open that run on Activity.
 */
export function decodeNav(search: string | null | undefined, opts: { runExists?: (id: string) => boolean } = {}): NavState {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return { ...DEFAULT_NAV };
  }
  const rawRun = (p.get("run") ?? "").trim();
  let run: string | null = rawRun || null;
  if (run && opts.runExists) {
    try {
      if (!opts.runExists(run)) run = null;
    } catch {
      run = null;
    }
  }
  return normalizeNav({
    section: (p.get("section") ?? undefined) as Section,
    run,
    view: (p.get("view") ?? undefined) as RunView,
    sub: (p.get("sub") ?? undefined) as DetailsSub,
    lesson: p.get("lesson"),
    component: p.get("component"),
    skill: p.get("skill"),
  });
}

export function sameNav(a: NavState, b: NavState): boolean {
  return a.section === b.section && a.run === b.run && a.view === b.view && a.sub === b.sub && (a.lesson ?? null) === (b.lesson ?? null) && (a.component ?? null) === (b.component ?? null) && (a.skill ?? null) === (b.skill ?? null);
}

// ---- Keyboard shortcuts ---------------------------------------------------

export type ShortcutAction =
  | { type: "view"; view: RunView }
  | { type: "section"; section: Section }
  | { type: "newRun" }
  | { type: "demo" }
  | { type: "help" }
  | { type: "pauseResume" }
  | { type: "close" };

export interface Shortcut {
  /** KeyboardEvent.key value. */
  key: string;
  /** How Help shows the key. */
  display: string;
  label: string;
  action: ShortcutAction;
}

/** The one shortcut map. App binds exactly these; Help lists exactly these. */
export const SHORTCUTS: readonly Shortcut[] = [
  { key: "1", display: "1", label: "Activity of the selected run", action: { type: "view", view: "activity" } },
  { key: "2", display: "2", label: "Contract", action: { type: "view", view: "contract" } },
  { key: "3", display: "3", label: "Changes (files and diffs)", action: { type: "view", view: "changes" } },
  { key: "4", display: "4", label: "Details (transcript, context, guardrails)", action: { type: "view", view: "details" } },
  { key: "r", display: "r", label: "Runs section", action: { type: "section", section: "runs" } },
  { key: "t", display: "t", label: "Reliability section (trial sets)", action: { type: "section", section: "reliability" } },
  { key: "h", display: "h", label: "Harness section", action: { type: "section", section: "harness" } },
  { key: "l", display: "l", label: "Lessons section", action: { type: "section", section: "lessons" } },
  { key: "n", display: "n", label: "New run", action: { type: "newRun" } },
  { key: "d", display: "d", label: "Open the recorded demo (creates it the first time)", action: { type: "demo" } },
  { key: " ", display: "space", label: "Pause / resume the selected live run (ignored while a control has focus)", action: { type: "pauseResume" } },
  { key: "?", display: "?", label: "Keyboard shortcuts (this list)", action: { type: "help" } },
  { key: "Escape", display: "esc", label: "Close dialogs and menus", action: { type: "close" } },
];

export function shortcutFor(key: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.key === key);
}

/** The documented key for an app section or run view. */
export function keyForSection(section: Section): string | undefined {
  return SHORTCUTS.find((s) => s.action.type === "section" && s.action.section === section)?.display;
}
export function keyForView(view: RunView): string | undefined {
  return SHORTCUTS.find((s) => s.action.type === "view" && s.action.view === view)?.display;
}

/** Apply a navigation shortcut to a state. Returns null for non-navigation actions. */
export function applyNavAction(state: NavState, action: ShortcutAction): NavState | null {
  if (action.type === "section") return normalizeNav({ ...state, section: action.section });
  // A run view needs a run; without one it is a no-op rather than a blank screen.
  if (action.type === "view") return state.run ? normalizeNav({ ...state, section: "runs", view: action.view }) : state;
  return null;
}

/** A run id the Stage can open: a run in the list, or a lesson intake job (they share the Stage but not the Runs list). */
export function isKnownRun(s: { runs: { id: string }[]; intakeJobs: { id: string }[] }, id: string): boolean {
  return s.runs.some((r) => r.id === id) || s.intakeJobs.some((j) => j.id === id);
}
