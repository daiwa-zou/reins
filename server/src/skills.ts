import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_SKILLS_DIR = path.resolve(here, "../../skills");

export interface Skill {
  name: string;
  description: string;
  /** Where it came from: bundled, user (~/.reins/skills) or workspace (.reins/skills). */
  source: "bundled" | "user" | "workspace";
  dir: string;
  body: string;
}

function parse(dir: string, source: Skill["source"]): Skill | null {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name: meta.name ?? path.basename(dir), description: meta.description ?? "", source, dir, body: m ? m[2].trim() : raw.trim() };
}

function scan(root: string, source: Skill["source"]): Skill[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => parse(path.join(root, d.name), source))
    .filter((s): s is Skill => !!s);
}

/**
 * Progressive disclosure: only name + description go into the prompt. The
 * body (and any files next to it) is read on demand with read_skill.
 * Workspace skills override user skills override bundled ones by name.
 */
export function loadSkills(workspace: string): Skill[] {
  const byName = new Map<string, Skill>();
  for (const s of scan(BUNDLED_SKILLS_DIR, "bundled")) byName.set(s.name, s);
  for (const s of scan(path.join(process.env.REINS_HOME ?? path.join(os.homedir(), ".reins"), "skills"), "user")) byName.set(s.name, s);
  for (const s of scan(path.join(workspace, ".reins", "skills"), "workspace")) byName.set(s.name, s);
  for (const s of scan(path.join(workspace, ".claude", "skills"), "workspace")) if (!byName.has(s.name)) byName.set(s.name, s);
  return [...byName.values()];
}

export function skillsPromptSection(skills: Skill[]): string {
  if (!skills.length) return "";
  return `# Skills\nRead a skill with read_skill(name) when its description matches what you are doing. Only the index is loaded.\n${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`;
}
