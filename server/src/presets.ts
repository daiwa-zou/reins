import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineId, Preset, PresetCompatibility, PresetConfig } from "../../shared/types.js";
import { compatibilityByEngine, composeRun, domainPresets, generatedPresets, isGeneratedPresetName, PresetCompositionError } from "../../shared/presets.js";
import { stageLessonsFor } from "../../shared/implications.js";
import { applyPreset } from "../../shared/config.js";
import { defaultRunConfig } from "../../shared/components.js";
import type { RunConfig } from "../../shared/types.js";
import { listLessons } from "./lessons.js";
import { BUILT_IN_PRESETS, FORBIDDEN_PRESET_KEYS, isBuiltInPresetName, PresetValidationError, sanitizePresetName, validatePresetConfig } from "../../shared/config.js";

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
        presets.push({ name, description: String(p.description ?? "").slice(0, 300), config: validatePresetConfig(p.config).config, createdAt: String(p.createdAt ?? ""), ...(lessons.length ? { lessons } : {}) });
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
  const all = [...BUILT_IN_PRESETS.map((p) => p.name), ...generatedPresets(listLessons()).map((p) => p.name), ...f.presets.map((p) => p.name)];
  return all.find((n) => n.toLowerCase() === f.default!.toLowerCase()) ?? null;
}

export type ListedPreset = Preset & { isDefault: boolean; compatibility: Record<EngineId, PresetCompatibility> };

/** Built-in, then lesson-generated (recomposed from the current lesson library on every call), then the user's. */
export function listPresets(): { presets: ListedPreset[]; default: string | null; file: string } {
  const f = read();
  const def = resolveDefault(f);
  const user: Preset[] = f.presets.map((p) => ({ name: p.name, description: p.description, builtIn: false, config: p.config, ...(p.lessons ? { lessons: p.lessons } : {}) }));
  const presets = [...BUILT_IN_PRESETS, ...generatedPresets(listLessons()), ...user].map((p) => ({ ...p, isDefault: p.name === def, compatibility: compatibilityByEngine(p) }));
  return { presets, default: def, file: presetsFile() };
}

/** Create or replace a user preset. Throws PresetValidationError with a one-line message for a bad body. */
export function savePreset(body: unknown): { preset: Preset; dropped: string[]; default: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PresetValidationError('body must be a JSON object like {"name":"mine","config":{...}}');
  const b = body as Record<string, unknown>;
  if (b.name === undefined || b.name === null || (typeof b.name === "string" && !b.name.trim())) throw new PresetValidationError("name is required");
  if (typeof b.name !== "string") throw new PresetValidationError("name must be a string");
  const name = sanitizePresetName(b.name);
  if (!name) throw new PresetValidationError("name must contain letters or digits");
  if (isBuiltInPresetName(name)) throw new PresetValidationError(`"${name}" is a built-in preset and cannot be overwritten; pick another name`);
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
  const exists = BUILT_IN_PRESETS.some((p) => p.name.toLowerCase() === name.toLowerCase()) || isGeneratedPresetName(name, listLessons()) || f.presets.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!exists) throw new PresetNotFound(`no preset named "${raw}"`);
  f.default = name;
  write(f);
  return resolveDefault(f);
}

export class PresetNotFound extends Error {}

/**
 * The run input after preset composition. With `presets` (one care profile
 * plus domains, e.g. ["careful","golang","cli"]) the composed config is the
 * base and any field the caller sent explicitly wins over it. The stage
 * lessons are always resolved here, so the run records what its agents saw.
 */
export function resolveRunInput<T extends Partial<RunConfig> & { task: string; workspace: string }>(input: T): T {
  const lessons = listLessons();
  if (!Array.isArray(input.presets) || !input.presets.length) {
    const { presets: _drop, ...rest } = input as any;
    return { ...rest, stageLessons: stageLessonsFor(lessons, []) } as T;
  }
  const composed = composeRun(input.presets.map(String), lessons);
  const base = applyPreset(defaultRunConfig({ task: input.task, workspace: input.workspace }), { name: composed.label, config: composed.config });
  const has = (k: keyof RunConfig) => input[k] !== undefined && input[k] !== null;
  const out: any = { ...base, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null)) };
  if (has("components")) out.components = { ...base.components, ...input.components };
  if (has("guidance")) out.guidance = [...new Set([...(base.guidance ?? []), ...(input.guidance ?? [])])];
  // The profile owns the engine unless the caller picked one explicitly.
  out.engine = input.engine ?? composed.config.engine ?? base.engine;
  out.presets = composed.presets;
  out.preset = input.preset ?? composed.label;
  out.stageLessons = composed.stageLessons;
  return out as T;
}

export { PresetCompositionError };

/** Care profiles and domain presets for the New run picker. */
export function composablePresets() {
  const lessons = listLessons();
  return { profiles: BUILT_IN_PRESETS.filter((p) => p.layer === "profile"), domains: domainPresets(lessons) };
}
