// The domain builder's pure parts: which implications can be picked, how the
// pick list is filtered, and how a draft starts. The modal renders over these.
import type { Implication, ImplicationKind, Lesson, UserDomain } from "@shared/types";

export type Pickable = Implication & { lessonTitle: string };

/** Trusted (bundled or reviewed), explicit implications of the library, with their lesson's title. */
export function pickable(lessons: Lesson[]): Pickable[] {
  const out: Pickable[] = [];
  for (const l of lessons) for (const i of l.items ?? []) if (!i.implicit && i.standing !== "unreviewed") out.push({ ...i, lessonTitle: l.title });
  return out;
}

export interface PickFilter {
  q?: string;
  kind?: ImplicationKind | null;
  lesson?: string | null;
  picked?: Set<string>;
  pickedOnly?: boolean;
}

export function filterImplications(items: Pickable[], f: PickFilter): Pickable[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return items.filter((i) => {
    if (f.kind && i.kind !== f.kind) return false;
    if (f.lesson && i.lesson !== f.lesson) return false;
    if (f.pickedOnly && !f.picked?.has(i.id)) return false;
    if (q && !`${i.claim} ${i.target ?? ""} ${i.lesson} ${i.lessonTitle} ${i.domains.join(" ")}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export type DomainDraft = Pick<UserDomain, "id" | "label" | "description" | "implications">;

/** An empty draft, one to edit an existing domain, or one seeded with a lesson's trusted implications. */
export function draftFor(domain?: UserDomain | null, lesson?: Lesson | null): DomainDraft {
  if (domain) return { id: domain.id, label: domain.label, description: domain.description, implications: [...domain.implications] };
  const seed = lesson ? (lesson.items ?? []).filter((i) => !i.implicit && i.standing !== "unreviewed").map((i) => i.id) : [];
  return { id: "", label: "", description: "", implications: seed };
}
