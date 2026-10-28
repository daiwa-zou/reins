import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listConfiguredMcpServers, resolveMcpInput } from "./mcpConfig.js";

// Claude Code keeps its MCP servers in ~/.claude.json (user scope, and per
// project under projects[<dir>]) and in a project's .mcp.json. Intake names one
// of them and gets the full spec, so nobody retypes a command.

describe("configured MCP servers", () => {
  let cfgDir: string;
  let proj: string;
  const prev = process.env.CLAUDE_CONFIG_DIR;
  beforeAll(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "reins-claude-cfg-"));
    proj = fs.mkdtempSync(path.join(os.tmpdir(), "reins-proj-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    fs.writeFileSync(
      path.join(cfgDir, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          wiki: { command: "node", args: ["/apps/wiki/server.js"], env: { WIKI_HOME: "/data" } },
          docs: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer x" } },
          "Bad Name": { command: "x" },
        },
        projects: { [proj]: { mcpServers: { local1: { command: "python", args: ["srv.py"] }, wiki: { command: "node", args: ["/apps/wiki/other.js"] } } } },
      }),
    );
    fs.writeFileSync(path.join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { proj1: { type: "stdio", command: "./bin/mcp" }, local1: { command: "overridden", args: [] } } }));
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(cfgDir, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it("lists user, local-project and project servers by name, project first, one entry per name, skipping names that cannot be a tool prefix", () => {
    const all = listConfiguredMcpServers(proj);
    expect(all.map((s) => [s.name, s.from])).toEqual([
      ["proj1", "project"],
      ["local1", "project"],
      ["wiki", "local"],
      ["docs", "user"],
    ]);
    expect(all.find((s) => s.name === "wiki")!.spec).toEqual({ name: "wiki", command: "node", args: ["/apps/wiki/other.js"] });
    expect(all.find((s) => s.name === "docs")!.spec).toEqual({ name: "docs", url: "https://docs.example/mcp", headers: { Authorization: "Bearer x" } });
    expect(all.find((s) => s.name === "proj1")!.spec).toEqual({ name: "proj1", command: "./bin/mcp", args: [] });
    // Without a project directory only the user scope is read.
    expect(listConfiguredMcpServers(undefined).map((s) => s.name)).toEqual(["wiki", "docs"]);
    expect(listConfiguredMcpServers(undefined).find((s) => s.name === "wiki")!.spec.args).toEqual(["/apps/wiki/server.js"]);
  });

  it("a name alone resolves to the configured spec; an unknown name says what is configured; a full spec still passes", () => {
    expect(resolveMcpInput({ name: "docs" }, proj)).toEqual({ name: "docs", url: "https://docs.example/mcp", headers: { Authorization: "Bearer x" } });
    expect(resolveMcpInput({ name: "WIKI" }, proj)).toMatchObject({ name: "wiki", command: "node" });
    expect(() => resolveMcpInput({ name: "nope" }, proj)).toThrow(/no MCP server named "nope".*proj1, local1, wiki, docs.*claude mcp add/);
    expect(resolveMcpInput({ name: "ad-hoc", command: "node", args: ["x.js"] }, proj)).toEqual({ name: "ad-hoc", command: "node", args: ["x.js"] });
    expect(() => resolveMcpInput({ name: "ad hoc", command: "x" }, proj)).toThrow(/mcp.name/);
    expect(() => resolveMcpInput(null, proj)).toThrow(/mcp must be/);
  });

  it("a missing or unreadable config means no servers, never a crash", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "reins-claude-empty-"));
    process.env.CLAUDE_CONFIG_DIR = empty;
    expect(listConfiguredMcpServers("/nowhere/at/all")).toEqual([]);
    fs.writeFileSync(path.join(empty, ".claude.json"), "{ not json");
    expect(listConfiguredMcpServers(undefined)).toEqual([]);
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
