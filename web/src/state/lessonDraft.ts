import type { ImplicationKind, Standing } from "@shared/types";
import { IMPLICATION_KINDS } from "@shared/lessons";

/** The kinds the approval card's select offers: the library's own list, so an effort implication keeps its kind. */
export { IMPLICATION_KINDS };

/** One implication of an intake draft, as the librarian proposed it (mirrors server/src/intake DraftImplication). */
export interface DraftImplication {
  kind: ImplicationKind;
  target: string;
  claim: string;
  quote: string;
  domains: string[];
}

/** The payload of a kind 'lesson' approval (mirrors server/src/intake DraftLesson). */
export interface DraftLessonPayload {
  slug: string;
  title: string;
  date?: string;
  url?: string;
  source?: string;
  takeaway?: string;
  tags?: string[];
  learnings?: string[];
  implications: DraftImplication[];
}

/** What the approval card sends back to the intake job. */
export interface LessonEdits {
  implications: DraftImplication[];
  standing: Exclude<Standing, "bundled">;
}

/** The card's editable state: every proposed implication with a dropped flag, and the standing. */
export interface LessonDraftState {
  items: (DraftImplication & { dropped?: boolean })[];
  standing: Exclude<Standing, "bundled">;
}

export function initLessonDraft(payload: DraftLessonPayload | null | undefined): LessonDraftState {
  return { items: (payload?.implications ?? []).map((i) => ({ ...i, domains: [...(i.domains ?? [])] })), standing: "unreviewed" };
}

export function dropImplication(s: LessonDraftState, i: number, dropped = true): LessonDraftState {
  return { ...s, items: s.items.map((x, j) => (j === i ? { ...x, dropped } : x)) };
}

export function editImplication(s: LessonDraftState, i: number, patch: Partial<DraftImplication>): LessonDraftState {
  return { ...s, items: s.items.map((x, j) => (j === i ? { ...x, ...patch, ...(patch.kind === "gap" ? { target: "" } : {}) } : x)) };
}

export function setDraftStanding(s: LessonDraftState, standing: Standing): LessonDraftState {
  return { ...s, standing: standing === "reviewed" ? "reviewed" : "unreviewed" };
}

/** "golang, cli" -> ["golang","cli"]: lower-cased, trimmed, de-duplicated. */
export function parseDomains(text: string): string[] {
  return [...new Set(text.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

export function toLessonEdits(s: LessonDraftState): LessonEdits {
  return {
    implications: s.items.filter((x) => !x.dropped).map(({ dropped: _d, ...x }) => ({ ...x, target: x.kind === "gap" ? "" : x.target.trim(), claim: x.claim.trim() })),
    standing: s.standing,
  };
}
