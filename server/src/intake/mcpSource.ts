// An MCP server as a lesson source for the direct engine: connect, list its
// tools, and expose each as a registry-shaped tool named mcp__<server>__<tool>
// (the same names the Claude Code engine gives attached servers, so prompts,
// events and the Stage read alike on both engines).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerSpec } from "../../../shared/types.js";
import type { ToolDef } from "../tools/registry.js";

export const MCP_SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export interface McpSource {
  /** Tools keyed by their mcp__<server>__<tool> name. */
  tools: Record<string, ToolDef>;
  /** One line per tool for the librarian's first message. */
  describe(): string;
  close(): Promise<void>;
}

/** Validate a server spec from the API; returns the problem, or null when it can be used. */
export function mcpSpecProblem(spec: unknown): string | null {
  const s = spec as McpServerSpec;
  if (!s || typeof s !== "object") return "mcp must be an object with name and command or url";
  if (typeof s.name !== "string" || !MCP_SERVER_NAME.test(s.name)) return "mcp.name must be a short lowercase name (letters, digits, - and _)";
  if (!s.url && !s.command) return "mcp needs a command to run or a url";
  if (s.url && !/^https?:\/\//i.test(s.url)) return "mcp.url must start with http:// or https://";
  if (s.args && (!Array.isArray(s.args) || s.args.some((a) => typeof a !== "string"))) return "mcp.args must be a list of strings";
  for (const k of ["env", "headers"] as const) {
    const v = s[k];
    if (v && (typeof v !== "object" || Object.values(v).some((x) => typeof x !== "string"))) return `mcp.${k} must map names to strings`;
  }
  return null;
}

/** Build the transport for a spec; split out so tests can hand in an in-memory one. */
export function mcpTransport(spec: McpServerSpec): Transport {
  if (spec.url) return new StreamableHTTPClientTransport(new URL(spec.url), spec.headers ? { requestInit: { headers: spec.headers } } : undefined);
  return new StdioClientTransport({ command: spec.command!, args: spec.args ?? [], env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) }, stderr: "ignore" });
}

/** Connect and list the server's tools. Throws when the server cannot be reached or offers no tools. */
export async function connectMcpSource(spec: McpServerSpec, transport: Transport = mcpTransport(spec)): Promise<McpSource> {
  const client = new Client({ name: "reins-intake", version: "0.1.0" });
  await client.connect(transport);
  const listed = (await client.listTools()).tools;
  if (!listed.length) {
    await client.close();
    throw new Error(`MCP server ${spec.name} offers no tools.`);
  }
  const tools: Record<string, ToolDef> = {};
  for (const t of listed) {
    const name = `mcp__${spec.name}__${t.name}`;
    tools[name] = {
      schema: { name, description: t.description ?? "", input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as any },
      deferred: false,
      readOnly: true,
      run: async (input) => {
        const r = (await client.callTool({ name: t.name, arguments: input ?? {} })) as { content?: unknown; isError?: boolean };
        const text = Array.isArray(r.content) ? r.content.map((c: any) => (c?.type === "text" ? String(c.text) : `[${c?.type ?? "content"}]`)).join("\n") : typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? "");
        if (r.isError) throw new Error(text || `${t.name} failed`);
        return text;
      },
    };
  }
  return {
    tools,
    describe: () => listed.map((t) => `- mcp__${spec.name}__${t.name}: ${(t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200)}`).join("\n"),
    close: () => client.close(),
  };
}
