// One starting-point model for New run, Harness and Lessons. Pure: vitest runs it in node.
//
// GET /api/presets returns three different things under one word "preset":
//   - the built-in care profiles (Full, Minimal, Careful) and the legacy "Claude Code" preset,
//   - presets generated from lessons (Web app, CLI / tool, Go, Python, ...),
//   - the user's own saved presets.
// The UI shows them as Profile, Domains and Saved preset, so each choice appears once.
// startingPointFor() maps an old name (a default, a run's `preset`) onto that model.
import type { EngineId, Preset } from "@shared/types";
import { PRESET_RECIPES, PROFILE_IDS, presetChip, type ProfileId } from "@shared/presets";

type Listed = Pick<Preset, "name" | "builtIn"> & Partial<Pick<Preset, "id" | "layer" | "generated" | "domain">>;

export interface ClassifiedPresets<P extends Listed> {
  /** Full, Minimal, Careful, in that order. */
  profiles: P[];
  /** Presets generated from lessons, one per domain. */
  domains: P[];
  /** The user's own presets: the only things the Saved preset select lists. */
  saved: P[];
}

const profileIdOf = (p: Listed): ProfileId | undefined => {
  if (!p.builtIn) return undefined;
  const id = (p.layer === "profile" ? p.id : undefined) ?? p.name.trim().toLowerCase();
  return (PROFILE_IDS as readonly string[]).includes(id) ? (id as ProfileId) : undefined;
};

/** Split the /api/presets list. Built-ins that are neither a profile nor a domain (Claude Code) go nowhere. */
export function classifyPresets<P extends Listed>(list: P[]): ClassifiedPresets<P> {
  const profiles: P[] = [];
  const domains: P[] = [];
  const saved: P[] = [];
  for (const p of list) {
    if (profileIdOf(p)) profiles.push(p);
    else if (p.generated || (p.builtIn && p.domain)) domains.push(p);
    else if (!p.builtIn) saved.push(p);
  }
  profiles.sort((a, b) => PROFILE_IDS.indexOf(profileIdOf(a)!) - PROFILE_IDS.indexOf(profileIdOf(b)!));
  return { profiles, domains, saved };
}

export type StartingPoint =
  /** A profile plus domains, e.g. ["careful", "web"]; `engine` when the old name implied one. */
  | { kind: "compose"; presets: string[]; engine?: EngineId }
  /** One of the user's saved presets, by its exact name. */
  | { kind: "saved"; name: string }
  /** Nothing we recognise: start from the settings as they are. */
  | { kind: "custom" };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Map a preset name onto the starting-point model:
 * - "Full" / "Minimal" / "Careful" -> that profile;
 * - a generated name ("Web app", "CLI / tool", "Go") -> [full, domain];
 * - "Claude Code" -> [full] on the claude-code engine;
 * - a composed label ("Careful · Web") -> those ids;
 * - one of `saved` -> that saved preset; anything else -> custom. Never throws.
 * A trailing " (modified)" (how runs record an edited preset) is ignored.
 */
export function startingPointFor(name: string | null | undefined, opts: { saved?: string[]; generated?: { name: string; domain?: string }[] } = {}): StartingPoint {
  if (typeof name !== "string" || !name.trim()) return { kind: "custom" };
  const raw = name.replace(/\s*\(modified\)\s*$/i, "");
  const n = norm(raw);
  const savedHit = (opts.saved ?? []).find((s) => norm(s) === n);
  if (savedHit) return { kind: "saved", name: savedHit };
  const profile = PROFILE_IDS.find((p) => p === n);
  if (profile) return { kind: "compose", presets: [profile] };
  if (n === "claude code") return { kind: "compose", presets: ["full"], engine: "claude-code" };
  const gen = [...PRESET_RECIPES.map((r) => ({ name: r.name, domain: r.id })), ...(opts.generated ?? [])].find((g) => g.domain && norm(g.name) === n);
  if (gen) return { kind: "compose", presets: ["full", gen.domain!] };
  // A composed label, as a run title chip shows it: "Careful · Go · CLI".
  if (raw.includes("·")) {
    const parts = raw.split("·").map(norm).filter(Boolean);
    const domainIds = [...PRESET_RECIPES.map((r) => r.id), ...(opts.generated ?? []).map((g) => g.domain).filter((d): d is string => !!d)];
    const ids = parts.map((part) => [...PROFILE_IDS, ...domainIds].find((id) => norm(presetChip(id)) === part || id === part));
    if (ids.every(Boolean)) {
      const profiles = ids.filter((id) => (PROFILE_IDS as readonly string[]).includes(id!));
      if (profiles.length <= 1) return { kind: "compose", presets: [profiles[0] ?? "full", ...ids.filter((id) => !profiles.includes(id)).map(String)] };
    }
  }
  return { kind: "custom" };
}

/** One line saying what a run starts from, e.g. "Careful · Web" or "your saved preset “mine”". */
export function describeStart(sp: StartingPoint): string {
  if (sp.kind === "saved") return `your saved preset “${sp.name}”`;
  if (sp.kind === "compose") return sp.presets.map(presetChip).join(" · ");
  return "custom settings";
}
