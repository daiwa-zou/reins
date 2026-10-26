// User-built domains live in one file, $REINS_HOME/domains.json:
//   { "domains": [{ "id", "label", "description", "implications": ["slug#n", ...], "createdAt" }] }
// Ids are slugs inside that file, never paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserDomain } from "../../shared/types.js";
import { DOMAIN_ID, validateUserDomain } from "../../shared/domains.js";
import { presetDomains } from "../../shared/presets.js";
import { listLessons } from "./lessons.js";

export class DomainValidationError extends Error {}
export class DomainNotFound extends Error {}

export function domainsFile(): string {
  return path.join(process.env.REINS_HOME ?? path.join(os.homedir(), ".reins"), "domains.json");
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

export function deleteDomain(id: string): void {
  const current = read();
  if (!current.some((d) => d.id === id)) throw new DomainNotFound(`no user domain "${id}"`);
  write(current.filter((d) => d.id !== id));
}
