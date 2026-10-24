import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Preset, PresetConfig } from "../../shared/types.js";
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
        presets.push({ name, description: String(p.description ?? "").slice(0, 300), config: validatePresetConfig(p.config).config, createdAt: String(p.createdAt ?? "") });
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
  const all = [...BUILT_IN_PRESETS.map((p) => p.name), ...f.presets.map((p) => p.name)];
  return all.find((n) => n.toLowerCase() === f.default!.toLowerCase()) ?? null;
}

export function listPresets(): { presets: (Preset & { isDefault: boolean })[]; default: string | null; file: string } {
  const f = read();
  const def = resolveDefault(f);
  const presets = [...BUILT_IN_PRESETS, ...f.presets.map((p) => ({ name: p.name, description: p.description, builtIn: false, config: p.config }))].map((p) => ({ ...p, isDefault: p.name === def }));
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
  if (b.config === undefined) throw new PresetValidationError("config is required (an object, e.g. {\"components\":{\"planner\":false}})");
  if (b.description !== undefined && typeof b.description !== "string") throw new PresetValidationError("description must be a string");
  if (b.default !== undefined && typeof b.default !== "boolean") throw new PresetValidationError("default must be true or false");
  const { config, dropped } = validatePresetConfig(b.config);
  const droppedAll = [...dropped];
  for (const k of Object.keys(b)) if (!["name", "description", "config", "default"].includes(k)) droppedAll.push(k);
  // Forbidden keys are reported by validatePresetConfig as dropped; make the reason explicit.
  const reported = droppedAll.map((k) => ((FORBIDDEN_PRESET_KEYS as readonly string[]).includes(k) ? `${k} (presets never carry ${k})` : k));
  const f = read();
  const stored: StoredPreset = { name, description: String(b.description ?? "").trim().slice(0, 300), config, createdAt: new Date().toISOString() };
  f.presets = [...f.presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), stored];
  if (b.default === true) f.default = name;
  else if (b.default === false && f.default?.toLowerCase() === name.toLowerCase()) f.default = null;
  write(f);
  return { preset: { name, description: stored.description, builtIn: false, config }, dropped: reported, default: resolveDefault(f) };
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
  const exists = BUILT_IN_PRESETS.some((p) => p.name.toLowerCase() === name.toLowerCase()) || f.presets.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!exists) throw new PresetNotFound(`no preset named "${raw}"`);
  f.default = name;
  write(f);
  return resolveDefault(f);
}

export class PresetNotFound extends Error {}
