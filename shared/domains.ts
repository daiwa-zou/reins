// User-built domains: a person picks implications from the lesson library and
// names the set. Picking an implication tags it with the domain, so the
// existing machinery (stage blocks, "lessons in this domain") sees it; the
// component and guidance effects are derived here. Pure: the server, the web
// UI and vitest share it.
import type { ComponentId, Implication, Lesson, Phase, UserDomain } from "./types.js";
import { COMPONENTS } from "./components.js";
import { isObj, str } from "./util.js";

/** A domain id: lowercase letters, digits and dashes, at most 40 characters. Shared by lessons, presets and config validation. */
export const DOMAIN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const DOMAIN_LABEL_MAX = 60;
export const DOMAIN_DESCRIPTION_MAX = 300;
export const DOMAIN_MAX_IMPLICATIONS = 200;

/** "My Stack! v2" -> "my-stack-v2". */
export function slugifyDomainId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export const allItems = (lessons: Lesson[]): Implication[] => lessons.flatMap((l) => l.items ?? []);

/**
 * Check a domain body against the library. `reserved` holds the ids a user
 * domain may not take (the built-in recipes and the domains lessons name).
 * Problems are one actionable sentence each; `domain` is normalised.
 */
export function validateUserDomain(raw: unknown, lessons: Lesson[], reserved: string[]): { domain: UserDomain; problems: string[] } {
  const problems: string[] = [];
  const o = isObj(raw) ? raw : {};
  const label = str(o.label).slice(0, DOMAIN_LABEL_MAX);
  if (!label) problems.push("Give the domain a label (the chip text in New run).");
  const id = str(o.id) || slugifyDomainId(label);
  if (!DOMAIN_ID.test(id)) problems.push(`The id "${str(o.id) || id}" must be lowercase letters, digits and dashes (at most 40), e.g. my-stack.`);
  else if (reserved.includes(id)) problems.push(`"${id}" is already a domain (a built-in one or one a lesson names); pick another id.`);
  const description = str(o.description).slice(0, DOMAIN_DESCRIPTION_MAX);
  const known = new Map(allItems(lessons).map((i) => [i.id, i]));
  const implications: string[] = [];
  for (const v of Array.isArray(o.implications) ? o.implications : []) {
    const iid = str(v);
    if (!iid || implications.includes(iid)) continue;
    const i = known.get(iid);
    if (!i) problems.push(`${iid} is not in the library (implication ids look like <lesson-slug>#<n>).`);
    else if (i.standing === "unreviewed") problems.push(`${iid} is unreviewed; mark its lesson reviewed in Lessons before building on it.`);
    implications.push(iid);
  }
  if (!implications.length) problems.push("Pick at least one implication.");
  if (implications.length > DOMAIN_MAX_IMPLICATIONS) problems.push(`At most ${DOMAIN_MAX_IMPLICATIONS} implications in one domain.`);
  return { domain: { id, label, description, implications }, problems };
}

/** The library with every picked implication tagged with its user domain's id. Untouched lessons keep their identity. */
export function tagUserDomains(lessons: Lesson[], domains: UserDomain[]): Lesson[] {
  if (!domains.length) return lessons;
  const tags = new Map<string, string[]>();
  for (const d of domains) for (const iid of d.implications) tags.set(iid, [...(tags.get(iid) ?? []), d.id]);
  if (!tags.size) return lessons;
  return lessons.map((l) => {
    if (!(l.items ?? []).some((i) => tags.has(i.id))) return l;
    return { ...l, items: l.items.map((i) => (tags.has(i.id) ? { ...i, domains: [...i.domains, ...tags.get(i.id)!.filter((t) => !i.domains.includes(t))] } : i)) };
  });
}

export interface DomainEffects {
  /** Effort- and engine-tier components the domain switches on. */
  enables: ComponentId[];
  /** Stage lines per phase (the claims), as the stage blocks will carry them. */
  stages: Partial<Record<Phase, string[]>>;
  /** Claims of foundation, skill and gap implications: one run-guidance line each. */
  guidance: string[];
  /** Picked implications that change nothing, each with the reason. */
  ignored: string[];
  /** The picked implications that exist, in the domain's order. */
  items: Implication[];
  /** The lessons they come from, in order of first appearance. */
  lessons: string[];
}

/** What a user domain does to a run, from the implications it was built from. */
export function domainEffects(domain: UserDomain, lessons: Lesson[]): DomainEffects {
  const known = new Map(allItems(lessons).map((i) => [i.id, i]));
  const out: DomainEffects = { enables: [], stages: {}, guidance: [], ignored: [], items: [], lessons: [] };
  for (const iid of domain.implications) {
    const i = known.get(iid);
    if (!i) continue;
    out.items.push(i);
    if (!out.lessons.includes(i.lesson)) out.lessons.push(i.lesson);
    if (i.kind === "component" && i.target) {
      const c = COMPONENTS.find((x) => x.id === i.target);
      if (!c) out.ignored.push(`${iid}: no component "${i.target}"`);
      else if (c.tier === "always") out.ignored.push(`${iid}: ${c.label} is always on`);
      else if (!out.enables.includes(c.id)) out.enables.push(c.id);
    } else if (i.kind === "stage" && i.target) {
      const p = i.target as Phase;
      out.stages[p] = [...(out.stages[p] ?? []), i.claim];
    } else if (i.kind === "effort") out.ignored.push(`${iid}: effort recommendations are shown, never applied`);
    else if (!out.guidance.includes(i.claim)) out.guidance.push(i.claim);
  }
  return out;
}
