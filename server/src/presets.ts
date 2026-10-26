import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ComponentId, Composition, EngineId, Preset, PresetCompatibility, PresetConfig } from "../../shared/types.js";
import { compatibilityByEngine, composeRun, compositionLabel, domainPresets, followEngine, generatedPresets, inferComposition, isGeneratedPresetName, LEGACY_PROFILES, migrateLegacy, PresetCompositionError, PRESET_RECIPES } from "../../shared/presets.js";
import { stageLessonsFor } from "../../shared/implications.js";
import { alwaysTierOffs, applyPreset, RETIRED_PRESET_NAMES } from "../../shared/config.js";
import { ALWAYS_IDS, DEFAULT_COMPOSITION, defaultRunConfig, EFFORT_LEVELS, EFFORT_TABLE, SUPERVISION_LEVELS, SUPERVISION_TABLE, tierOf } from "../../shared/components.js";
import type { RunConfig } from "../../shared/types.js";
import { listLessons } from "./lessons.js";
import { listDomains } from "./domains.js";
import { tagUserDomains } from "../../shared/domains.js";
import { FORBIDDEN_PRESET_KEYS, isBuiltInPresetName, PresetValidationError, sanitizePresetName, validatePresetConfig } from "../../shared/config.js";

/**
 * User presets live in one file, $REINS_HOME/presets.json:
 *   { "default": "mine" | null, "presets": [{ "name", "description", "config", "createdAt" }] }
 * Names are labels inside that file, never paths, so a name cannot create a file.
 */
interface StoredPreset {
  name: string;
  description: string;
  config: PresetConfig;
  createdAt: string;
  lessons?: string[];
}
interface PresetFile {
  default: string | null;
  presets: StoredPreset[];
}

export function presetsFile(): string {
  return path.join(process.env.REINS_HOME ?? path.join(os.homedir(), ".reins"), "presets.json");
}

function read(): PresetFile {
  try {
    const raw = JSON.parse(fs.readFileSync(presetsFile(), "utf8"));
    const presets: StoredPreset[] = [];
    for (const p of Array.isArray(raw?.presets) ? raw.presets : []) {
      const name = sanitizePresetName(p?.name);
      if (!name || isBuiltInPresetName(name)) continue;
      try {
        const lessons = Array.isArray(p.lessons) ? p.lessons.filter((s: unknown): s is string => typeof s === "string").slice(0, 50) : [];
        // Migrate on read (the file is never rewritten): always-tier offs are dropped, and a
        // legacy entry without a composition gets one inferred from its settings.
        const config = validatePresetConfig(p.config, { legacy: true }).config;
        if (!config.effort || !config.supervision) Object.assign(config, { ...inferComposition(config), ...(config.effort ? { effort: config.effort } : {}), ...(config.supervision ? { supervision: config.supervision } : {}) });
        presets.push({ name, description: String(p.description ?? "").slice(0, 300), config, createdAt: String(p.createdAt ?? ""), ...(lessons.length ? { lessons } : {}) });
      } catch {
        /* a hand-edited entry with a bad field is ignored rather than crashing the list */
      }
    }
    const def = typeof raw?.default === "string" ? raw.default : null;
    return { default: def, presets };
  } catch {
    return { default: null, presets: [] };
  }
}

function write(f: PresetFile) {
  const file = presetsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function resolveDefault(f: PresetFile): string | null {
  if (!f.default) return null;
  const all = [...generatedPresets(listLessons(), listDomains()).map((p) => p.name), ...f.presets.map((p) => p.name)];
  return all.find((n) => n.toLowerCase() === f.default!.toLowerCase()) ?? null;
}

/** The composition New run opens on: the default preset's, or a retired name migrated (Careful → high + ask every write). */
function defaultComposition(f: PresetFile): Composition & { engine?: EngineId } {
  const name = f.default ?? "";
  const user = f.presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (user) return { effort: user.config.effort ?? DEFAULT_COMPOSITION.effort, supervision: user.config.supervision ?? DEFAULT_COMPOSITION.supervision, domains: user.config.domains ?? [], ...(user.config.engine && user.config.engine !== "replay" ? { engine: user.config.engine } : {}) };
  const recipe = generatedPresets(listLessons(), listDomains()).find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (recipe?.domain) return { ...DEFAULT_COMPOSITION, domains: [recipe.domain] };
  return migrateLegacy(name);
}

export type ListedPreset = Preset & { isDefault: boolean; compatibility: Record<EngineId, PresetCompatibility> };

/** Lesson-generated (recomposed from the current lesson library on every call), then the user's. */
export function listPresets(): { presets: ListedPreset[]; default: string | null; defaultComposition: Composition & { engine?: EngineId }; file: string } {
  const f = read();
  const def = resolveDefault(f);
  const user: Preset[] = f.presets.map((p) => ({ name: p.name, description: p.description, builtIn: false, config: p.config, ...(p.lessons ? { lessons: p.lessons } : {}) }));
  const presets = [...generatedPresets(listLessons(), listDomains()), ...user].map((p) => ({ ...p, isDefault: p.name === def, compatibility: compatibilityByEngine(p) }));
  return { presets, default: def, defaultComposition: defaultComposition(f), file: presetsFile() };
}

/** Create or replace a user preset. Throws PresetValidationError with a one-line message for a bad body. */
export function savePreset(body: unknown): { preset: Preset; dropped: string[]; default: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PresetValidationError('body must be a JSON object like {"name":"mine","config":{...}}');
  const b = body as Record<string, unknown>;
  if (b.name === undefined || b.name === null || (typeof b.name === "string" && !b.name.trim())) throw new PresetValidationError("name is required");
  if (typeof b.name !== "string") throw new PresetValidationError("name must be a string");
  const name = sanitizePresetName(b.name);
  if (!name) throw new PresetValidationError("name must contain letters or digits");
  if (isBuiltInPresetName(name)) throw new PresetValidationError(`"${name}" is a retired built-in preset name; pick another name`);
  if (isGeneratedPresetName(name, listLessons()) || isGeneratedPresetName(b.name, listLessons())) throw new PresetValidationError(`"${name}" is a preset generated from lessons and cannot be overwritten; pick another name`);
  if (b.lessons !== undefined && (!Array.isArray(b.lessons) || b.lessons.some((s) => typeof s !== "string"))) throw new PresetValidationError("lessons must be an array of lesson slugs");
  if (b.config === undefined) throw new PresetValidationError("config is required (an object, e.g. {\"components\":{\"planner\":false}})");
  if (b.description !== undefined && typeof b.description !== "string") throw new PresetValidationError("description must be a string");
  if (b.default !== undefined && typeof b.default !== "boolean") throw new PresetValidationError("default must be true or false");
  const { config, dropped } = validatePresetConfig(b.config);
  const droppedAll = [...dropped];
  for (const k of Object.keys(b)) if (!["name", "description", "config", "default", "lessons"].includes(k)) droppedAll.push(k);
  const known = new Set(listLessons().map((l) => l.slug));
  const lessons = [...new Set((b.lessons as string[] | undefined) ?? [])].filter((s) => {
    if (known.has(s)) return true;
    droppedAll.push(`lessons.${s} (no such lesson)`);
    return false;
  });
  // Forbidden keys are reported by validatePresetConfig as dropped; make the reason explicit.
  const reported = droppedAll.map((k) => ((FORBIDDEN_PRESET_KEYS as readonly string[]).includes(k) ? `${k} (presets never carry ${k})` : k));
  const f = read();
  const stored: StoredPreset = { name, description: String(b.description ?? "").trim().slice(0, 300), config, createdAt: new Date().toISOString(), ...(lessons.length ? { lessons } : {}) };
  f.presets = [...f.presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), stored];
  if (b.default === true) f.default = name;
  else if (b.default === false && f.default?.toLowerCase() === name.toLowerCase()) f.default = null;
  write(f);
  return { preset: { name, description: stored.description, builtIn: false, config, ...(lessons.length ? { lessons } : {}) }, dropped: reported, default: resolveDefault(f) };
}

export function deletePreset(rawName: string): void {
  const name = sanitizePresetName(rawName);
  if (isBuiltInPresetName(name || rawName)) throw new PresetValidationError(`"${rawName}" is a built-in preset and cannot be deleted`);
  const f = read();
  const before = f.presets.length;
  f.presets = f.presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  if (f.presets.length === before) throw new PresetNotFound(`no user preset named "${rawName}"`);
  if (f.default?.toLowerCase() === name.toLowerCase()) f.default = null;
  write(f);
}

/** Mark any preset (built-in or user) as the New run default, or clear it with null. */
export function setDefaultPreset(raw: unknown): string | null {
  if (raw !== null && typeof raw !== "string") throw new PresetValidationError("name must be a preset name or null");
  const f = read();
  if (raw === null || raw === "") {
    f.default = null;
    write(f);
    return null;
  }
  const name = sanitizePresetName(raw);
  const exists = RETIRED_PRESET_NAMES.some((n) => n.toLowerCase() === name.toLowerCase()) || isGeneratedPresetName(name, listLessons()) || f.presets.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!exists) throw new PresetNotFound(`no preset named "${raw}"`);
  f.default = name;
  write(f);
  return resolveDefault(f);
}

export class PresetNotFound extends Error {}

/**
 * The run input after composition. The body names `effort`, `supervision` and
 * `domains` (or the legacy `presets: ["careful","golang","cli"]`, migrated);
 * the composed config is the base and any field the caller sent explicitly
 * wins over it. Always-tier components stay on unless listed in `ablated`
 * (anything else is a 400 naming the component). Components the engine does
 * not honour follow the engine. The stage lessons are resolved here, so the
 * run records what its agents saw.
 *
 * `verbatim` (repeat, demo) reuses a recorded config as is, ablations and
 * legacy always-tier offs included: a trial set needs identical configs.
 */
export function resolveRunInput<T extends Partial<RunConfig> & { task: string; workspace: string }>(input: T, opts: { verbatim?: boolean } = {}): T {
  const lessons = listLessons();
  const userDomains = listDomains();
  if (opts.verbatim) return { ...input, stageLessons: input.stageLessons ?? stageLessonsFor(tagUserDomains(lessons, userDomains), input.domains ?? []) } as T;
  const raw = input as any;
  let ablated: ComponentId[] = [];
  if (raw.ablated !== undefined && raw.ablated !== null) {
    if (!Array.isArray(raw.ablated)) throw new PresetCompositionError("ablated must be an array of always-tier component ids, e.g. [\"compaction\"]");
    for (const id of raw.ablated) if (tierOf(String(id)) !== "always") throw new PresetCompositionError(`ablated: "${String(id)}" is not an always-tier component; only always-on components can be ablated (${ALWAYS_IDS().join(", ")})`);
    ablated = [...new Set(raw.ablated.map(String))] as ComponentId[];
  }
  if (raw.components && typeof raw.components === "object") {
    const offs = alwaysTierOffs(raw.components, ablated);
    if (offs.length) throw new PresetCompositionError(`components.${offs.join(", components.")} ${offs.length === 1 ? "is" : "are"} always on; to run without ${offs.join(", ")} start an experiment with ablated: ${JSON.stringify(offs)}`);
  }
  const legacy = Array.isArray(raw.presets) && raw.presets.length && raw.effort == null && raw.supervision == null && raw.domains == null;
  let comp: Partial<Composition> = { effort: raw.effort ?? undefined, supervision: raw.supervision ?? undefined, domains: raw.domains ?? undefined };
  let legacyEngine: EngineId | undefined;
  if (legacy) {
    const ids = (raw.presets as unknown[]).map((x) => String(x).trim().toLowerCase());
    const known = [...Object.keys(LEGACY_PROFILES), ...PRESET_RECIPES.map((r) => r.id)];
    const m = migrateLegacy(ids);
    for (const id of ids) if (!known.includes(id) && !m.domains.includes(id)) throw new PresetCompositionError(`unknown preset "${id}"`);
    comp = m;
    legacyEngine = m.engine;
  }
  const engine = (input.engine ?? legacyEngine ?? "anthropic") as RunConfig["engine"];
  const composed = composeRun(comp, lessons, PRESET_RECIPES, engine === "replay" ? undefined : engine, userDomains);
  const label = compositionLabel(composed, ablated);
  const base = applyPreset(defaultRunConfig({ task: input.task, workspace: input.workspace }), { name: label, config: composed.config });
  const out: any = { ...base, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null)) };
  const has = (k: keyof RunConfig) => input[k] !== undefined && input[k] !== null;
  if (has("components")) out.components = { ...base.components, ...input.components };
  for (const k of ["pauses", "context", "guardrail"] as const) if (has(k)) out[k] = { ...base[k], ...(input[k] as object) };
  if (has("roles")) out.roles = { ...base.roles, ...input.roles };
  if (has("guidance")) out.guidance = [...new Set([...(base.guidance ?? []), ...(input.guidance ?? [])])];
  out.engine = engine;
  for (const id of ablated) out.components[id] = false;
  if (engine !== "replay") out.components = followEngine(out, engine).components;
  delete out.presets;
  out.effort = composed.effort;
  out.supervision = composed.supervision;
  out.domains = composed.domains;
  if (ablated.length) out.ablated = ablated;
  else delete out.ablated;
  out.preset = label;
  out.stageLessons = composed.stageLessons;
  return out as T;
}

export { PresetCompositionError };

/** The two dials and the domain presets for the New run picker. */
export function composablePresets() {
  const lessons = listLessons();
  return {
    efforts: EFFORT_LEVELS.map((id) => ({ id, ...EFFORT_TABLE[id] })),
    supervisions: SUPERVISION_LEVELS.map((id) => ({ id, ...SUPERVISION_TABLE[id] })),
    domains: domainPresets(lessons, listDomains()),
    userDomains: listDomains(),
  };
}
