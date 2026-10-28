// The MCP servers Claude Code already knows: user scope and per-project
// entries in ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json), and a
// project's .mcp.json. Intake names one and gets its full spec, so nobody
// retypes a command the CLI already has.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServerSpec } from "../../../shared/types.js";
import { MCP_SERVER_NAME, mcpSpecProblem } from "./mcpSource.js";

export interface ConfiguredMcpServer {
  name: string;
  /** Where it is configured: the project's .mcp.json, the project's entry in ~/.claude.json, or the user scope. */
  from: "project" | "local" | "user";
  spec: McpServerSpec;
}

export function claudeConfigFile(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR ?? os.homedir(), ".claude.json");
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Claude Code's config shape ({ type?, command, args, env } or { type, url, headers }) to Reins' spec. */
function toSpec(name: string, raw: unknown): McpServerSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strs = (v: unknown) => (v && typeof v === "object" && Object.values(v as object).every((x) => typeof x === "string") ? (v as Record<string, string>) : undefined);
  if (typeof r.url === "string" && r.url) return { name, url: r.url, ...(strs(r.headers) ? { headers: strs(r.headers) } : {}) };
  if (typeof r.command === "string" && r.command) return { name, command: r.command, args: Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === "string") : [], ...(strs(r.env) ? { env: strs(r.env) } : {}) };
  return null;
}

function entries(raw: unknown, from: ConfiguredMcpServer["from"]): ConfiguredMcpServer[] {
  const out: ConfiguredMcpServer[] = [];
  for (const [name, v] of Object.entries((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>)) {
    if (!MCP_SERVER_NAME.test(name)) continue;
    const spec = toSpec(name, v);
    if (spec) out.push({ name, from, spec });
  }
  return out;
}

/** Every configured server, one per name: the project's .mcp.json wins over the project entry, which wins over the user scope. */
export function listConfiguredMcpServers(cwd: string | undefined): ConfiguredMcpServer[] {
  const seen = new Set<string>();
  const out: ConfiguredMcpServer[] = [];
  const add = (list: ConfiguredMcpServer[]) => {
    for (const s of list) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      out.push(s);
    }
  };
  const user = readJson(claudeConfigFile());
  if (cwd) {
    add(entries(readJson(path.join(cwd, ".mcp.json"))?.mcpServers, "project"));
    const projects = (user?.projects ?? {}) as Record<string, { mcpServers?: unknown }>;
    const local = projects[cwd] ?? projects[path.resolve(cwd)];
    add(entries(local?.mcpServers, "local"));
  }
  add(entries(user?.mcpServers, "user"));
  return out;
}

/**
 * The server an intake request names. `{ name }` alone looks the name up in
 * Claude Code's configuration; a full spec (command or url) is validated and
 * used as given.
 */
export function resolveMcpInput(input: unknown, cwd: string | undefined): McpServerSpec {
  if (!input || typeof input !== "object") throw new Error("mcp must be an object with the name of a configured MCP server (or name and command/url)");
  const m = input as Partial<McpServerSpec>;
  if (!m.command && !m.url) {
    const name = typeof m.name === "string" ? m.name.trim().toLowerCase() : "";
    const all = listConfiguredMcpServers(cwd);
    const hit = all.find((s) => s.name === name);
    if (!hit) throw new Error(`no MCP server named "${m.name ?? ""}" is configured for Claude Code${all.length ? ` (configured: ${all.map((s) => s.name).join(", ")})` : ""}; add one with \`claude mcp add\` or a .mcp.json, or give its command or url here`);
    return hit.spec;
  }
  const problem = mcpSpecProblem(m);
  if (problem) throw new Error(problem);
  return { name: m.name!, ...(m.command ? { command: m.command, args: m.args ?? [] } : {}), ...(m.env ? { env: m.env } : {}), ...(m.url ? { url: m.url } : {}), ...(m.headers ? { headers: m.headers } : {}) };
}
