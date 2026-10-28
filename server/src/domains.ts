// User-built domains live in one file, $REINS_HOME/domains.json:
//   { "domains": [{ "id", "label", "description", "implications": ["slug#n", ...], "createdAt" }] }
// Ids are slugs inside that file, never paths.
import fs from "node:fs";
import path from "node:path";
import type { UserDomain } from "../../shared/types.js";
import { DOMAIN_ID, validateUserDomain } from "../../shared/domains.js";
import { presetDomains } from "../../shared/presets.js";
import { listLessons } from "./lessons.js";
import { reinsHome } from "./store/runStore.js";

export class DomainValidationError extends Error {}
export class DomainNotFound extends Error {}

export function domainsFile(): string {
  return path.join(reinsHome(), "domains.json");
}

function read(): UserDomain[] {
  try {
    const raw = JSON.parse(fs.readFileSync(domainsFile(), "utf8"));
    const out: UserDomain[] = [];
    for (const d of Array.isArray(raw?.domains) ? raw.domains : []) {
      const id = typeof d?.id === "string" ? d.id : "";
      if (!DOMAIN_ID.test(id) || out.some((x) => x.id === id)) continue;
      const implications = Array.isArray(d.implications) ? d.implications.filter((x: unknown): x is string => typeof x === "string") : [];
      out.push({ id, label: String(d.label ?? id).slice(0, 60), description: String(d.description ?? "").slice(0, 300), implications, ...(typeof d.createdAt === "string" ? { createdAt: d.createdAt } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

function write(domains: UserDomain[]) {
  const file = domainsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ domains }, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** The user's domains, as stored (an implication that has since left the library simply has no effect). */
export function listDomains(): UserDomain[] {
  return read();
}

/** Create or replace (by id) a user domain. Throws DomainValidationError with every problem on one line. */
export function saveDomain(body: unknown): UserDomain {
  const current = read();
  const lessons = listLessons();
  // Reserved: the built-in recipes and every domain a lesson names. A user domain's own id is not
  // among them (the raw library carries no user tags), so saving again with the same id replaces it.
  const reserved = presetDomains(lessons);
  const { domain, problems } = validateUserDomain(body, lessons, reserved);
  if (problems.length) throw new DomainValidationError(problems.join(" "));
  const prev = current.find((d) => d.id === domain.id);
  const stored: UserDomain = { ...domain, createdAt: prev?.createdAt ?? new Date().toISOString() };
  write([...current.filter((d) => d.id !== domain.id), stored]);
  return stored;
}

/** What deleting a lesson does to the user's domains: implications dropped per domain, and domains that would be left empty (removed). */
export interface DomainPrune {
  id: string;
  label: string;
  /** Implication ids of the lesson this domain picked. */
  dropped: string[];
  /** Nothing else was in it, so the whole domain goes. */
  deleted: boolean;
}

/** Drop every implication of `slug` from the user's domains; a domain built only from it is deleted. `dry` reports without writing. */
export function pruneLessonFromDomains(slug: string, dry = false): DomainPrune[] {
  const current = read();
  const out: DomainPrune[] = [];
  const kept: UserDomain[] = [];
  for (const d of current) {
    const dropped = d.implications.filter((iid) => iid.split("#")[0] === slug);
    if (!dropped.length) {
      kept.push(d);
      continue;
    }
    const rest = d.implications.filter((iid) => !dropped.includes(iid));
    out.push({ id: d.id, label: d.label, dropped, deleted: !rest.length });
    if (rest.length) kept.push({ ...d, implications: rest });
  }
  if (out.length && !dry) write(kept);
  return out;
}

export function deleteDomain(id: string): void {
  const current = read();
  if (!current.some((d) => d.id === id)) throw new DomainNotFound(`no user domain "${id}"`);
  write(current.filter((d) => d.id !== id));
}
