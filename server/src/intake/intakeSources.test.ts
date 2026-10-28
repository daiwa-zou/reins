// Intake from explored sources: a git repository (read in place, or cloned)
// and an MCP server. What the librarian reads becomes source.md, and quotes
// are checked against that record, not the whole repository.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { RunEvent } from "../../../shared/types.js";
import { IntakeManager, IntakeRefused, resolveSource, type DraftLesson } from "./intake.js";
import { connectMcpSource } from "./mcpSource.js";
import { getLesson, invalidateLessons, lessonProblems } from "../lessons.js";
import { fakeClient, toolUse } from "../engine/scripted.js";

const call = (id: string, name: string, input: any) => ({ content: [toolUse(id, name, input)], stop_reason: "tool_use" as const });
const propose = (id: string, draft: Partial<DraftLesson>) => call(id, "propose_lesson", draft);
const waitApproval = async (mgr: IntakeManager, id: string) => {
  for (let i = 0; i < 300 && !mgr.pendingApprovals(id).length && mgr.isActive(id); i++) await new Promise((r) => setTimeout(r, 10));
  return mgr.pendingApprovals(id)[0];
};

const RETRY_GO = `package client

// Retry re-runs fn up to three times, sleeping 200ms between attempts; a context error ends it early.
func Retry(fn func() error) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if err = fn(); err == nil {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("gave up after 3 attempts: %w", err)
}
`;

describe("intake from a git repository", () => {
  let home: string;
  let repo: string;
  const prev = process.env.REINS_HOME;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "reins-intake-src-"));
    process.env.REINS_HOME = home;
    invalidateLessons();
    repo = path.join(home, "sample-repo");
    fs.mkdirSync(path.join(repo, "client"), { recursive: true });
    fs.writeFileSync(path.join(repo, "client", "retry.go"), RETRY_GO);
    fs.writeFileSync(path.join(repo, "README.md"), "# sample\n\nA client library.\n");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });
  afterAll(() => {
    process.env.REINS_HOME = prev;
    invalidateLessons();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const draft: DraftLesson = {
    slug: "sample-repo-retries",
    title: "How the sample client retries",
    date: "2026-10-27",
    url: "",
    source: "repo",
    takeaway: "Three attempts with a fixed 200ms sleep, then a wrapped error.",
    tags: ["retries"],
    learnings: ["Retry re-runs fn up to three times, sleeping 200ms between attempts."],
    implications: [
      { kind: "component", target: "evaluator", claim: "Retry a flaky check a fixed number of times before failing.", quote: "for attempt := 0; attempt < 3; attempt++", domains: ["golang"] },
      { kind: "stage", target: "build", claim: "Wrap the last error when giving up so the cause survives.", quote: 'gave up after 3 attempts: %w', domains: [] },
    ],
  };

  it("needs a focus, reads the folder in place, records what was read as source.md, and checks quotes against it", async () => {
    const { client, calls } = fakeClient([
      call("s1", "search", { pattern: "Retry", path: "." }),
      call("t1", "think", { thought: "The README says: A client library. I will quote that." }),
      call("r1", "read_file", { path: "client/retry.go" }),
      // A quote from a file the librarian never read is rejected.
      propose("p1", { ...draft, implications: [...draft.implications, { kind: "gap", target: "", claim: "Made up.", quote: "A client library.", domains: [] }] }),
      // The librarian may call it a note; the job knows it is a repository.
      propose("p2", { ...draft, source: "note" }),
    ]);
    const mgr = new IntakeManager({ client: () => client, hasClaudeCode: () => false });
    const events: RunEvent[] = [];
    mgr.on("event", (e: RunEvent) => events.push(e));
    expect(() => mgr.start({ repo })).toThrow(/what to look for/);
    const { id, slug } = mgr.start({ repo, focus: "How failed requests are retried" });
    expect(slug).toBe("sample-repo-how-failed-requests-are-retried");
    expect(mgr.list()[0]).toMatchObject({ id, focus: "How failed requests are retried", source: { kind: "repo", repo } });
    // The librarian works in the repository itself, with read-only tools, and is told what to look for.
    const req = await waitApproval(mgr, id);
    expect(req?.kind).toBe("lesson");
    const first = String(calls[0].messages[0].content);
    expect(first).toContain("# What to look for\nHow failed requests are retried");
    expect(first).toContain("client/");
    expect(calls[0].tools.map((t: any) => t.name).filter((n: string) => n !== "propose_lesson").sort()).toEqual(["list_files", "read_file", "search", "think"]);
    expect(JSON.stringify(calls[4].messages)).toContain("not found verbatim");
    const dir = path.join(home, "lessons", slug);
    const source = fs.readFileSync(path.join(dir, "source.md"), "utf8");
    expect(source).toContain("# client/retry.go");
    expect(source).toContain(RETRY_GO);
    expect(source).not.toContain("A client library."); // README was never read, and a think note is not a source

    mgr.approve(id, req.approvalId, "approve", undefined, { standing: "reviewed" });
    await mgr.settled(id);
    invalidateLessons();
    const l = getLesson("sample-repo-retries")!;
    expect(l).toMatchObject({ provenance: "repo", focus: "How failed requests are retried", standing: "reviewed", url: "" });
    expect(lessonProblems().filter((p) => p.file === "sample-repo-retries.md")).toEqual([]);
    expect(events.some((e) => e.type === "note" && /Recorded what the librarian read: 1 file/.test(e.text))).toBe(true);
    // The same folder with another focus is another lesson; the same focus while a job runs is refused.
    const again = mgr.start({ repo, focus: "How errors are logged" });
    expect(again.slug).toBe("sample-repo-how-errors-are-logged");
    expect(() => mgr.start({ repo, focus: "how errors are LOGGED" })).toThrow(IntakeRefused);
    mgr.cancel(again.id);
    await mgr.settled(again.id);
  });

  it("clones a git URL shallowly into the job folder and distils from the clone", async () => {
    const { client } = fakeClient([call("r1", "read_file", { path: "client/retry.go" }), propose("p1", { ...draft, slug: "cloned-retries" })]);
    const mgr = new IntakeManager({ client: () => client, hasClaudeCode: () => false });
    const url = `file://${repo}`;
    const { id, slug } = mgr.start({ repo: url, ref: "main", focus: "retries", title: "cloned retries" });
    expect(slug).toBe("cloned-retries");
    const req = await waitApproval(mgr, id);
    expect(req?.kind).toBe("lesson");
    const clone = path.join(home, "lessons", slug, "repo");
    expect(fs.existsSync(path.join(clone, "client", "retry.go"))).toBe(true);
    expect(fs.existsSync(path.join(clone, ".git", "shallow"))).toBe(true);
    expect(mgr.list().find((j) => j.id === id)).toMatchObject({ url, source: { kind: "repo", repo: url, ref: "main" } });
    mgr.approve(id, req.approvalId, "approve");
    await mgr.settled(id);
    invalidateLessons();
    // A file:// URL is not a web address, so the lesson carries no url: line.
    expect(getLesson("cloned-retries")).toMatchObject({ provenance: "repo", url: "" });
  });

  it("refuses a path that is not a folder or a git URL", () => {
    expect(() => resolveSource({ repo: "not/a/real/place", focus: "x" }, "")).toThrow(/neither a directory/);
    expect(() => resolveSource({ repo: "https://example.com/a.git", ref: "bad ref", focus: "x" }, "")).toThrow(/branch or tag/);
    expect(() => resolveSource({ url: "https://a", text: "b" }, "")).toThrow(/one source/);
    expect(() => resolveSource({ mcp: { name: "Bad Name", command: "x" }, focus: "x" }, "")).toThrow(/mcp\.name/);
    expect(() => resolveSource({ mcp: { name: "ok" }, focus: "x" }, "")).toThrow(/no MCP server named "ok"/);
  });
});

describe("intake from an MCP server", () => {
  let home: string;
  const prev = process.env.REINS_HOME;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "reins-intake-mcp-"));
    process.env.REINS_HOME = home;
    invalidateLessons();
  });
  afterAll(() => {
    process.env.REINS_HOME = prev;
    invalidateLessons();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const NOTE = "Deploy note 2026-09: rolling out to 5% of hosts first caught the config regression before it reached the fleet; full rollouts now wait 30 minutes at 5%.";
  /** A notes server with a search tool, served over an in-memory transport. */
  const notesServer = async () => {
    const server = new McpServer({ name: "notes", version: "0" });
    server.registerTool("search_notes", { description: "Find notes by keyword.", inputSchema: { query: z.string() } }, async ({ query }) => ({
      content: [{ type: "text", text: /deploy|rollout/i.test(query) ? NOTE : "No notes match." }],
    }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    return clientSide;
  };

  it("attaches the server's tools as mcp__<name>__*, records their results as the source, and adopts a lesson quoting them", async () => {
    const draft: DraftLesson = {
      slug: "notes-rollouts",
      title: "Canary before the fleet",
      date: "2026-09-01",
      url: "",
      source: "mcp",
      takeaway: "A 5% canary with a 30-minute wait catches regressions before the fleet.",
      tags: ["deploy"],
      learnings: ["Rolling out to 5% of hosts first caught the config regression."],
      implications: [{ kind: "stage", target: "publish", claim: "Stage a rollout to a small share first and wait before going wide.", quote: "full rollouts now wait 30 minutes at 5%", domains: [] }],
    };
    const { client, calls } = fakeClient([call("q1", "mcp__notes__search_notes", { query: "rollout" }), propose("p1", draft)]);
    const mgr = new IntakeManager({ client: () => client, hasClaudeCode: () => false, mcpSource: (spec) => notesServer().then((t) => connectMcpSource(spec, t)) });
    const { id, slug } = mgr.start({ mcp: { name: "notes", command: "irrelevant-with-injected-transport" }, focus: "what we learned about rollouts" });
    expect(slug).toBe("notes-what-we-learned-about-rollouts");
    const req = await waitApproval(mgr, id);
    expect(req?.kind).toBe("lesson");
    expect(calls[0].tools.map((t: any) => t.name).filter((n: string) => n !== "propose_lesson").sort()).toEqual(["mcp__notes__search_notes", "think"]);
    expect(String(calls[0].messages[0].content)).toContain("- mcp__notes__search_notes: Find notes by keyword.");
    // The tool's answer reached the model and became the source record.
    expect(JSON.stringify(calls[1].messages)).toContain("full rollouts now wait 30 minutes");
    expect(fs.readFileSync(path.join(home, "lessons", slug, "source.md"), "utf8")).toContain(NOTE);
    mgr.approve(id, req.approvalId, "approve", undefined, { standing: "reviewed" });
    await mgr.settled(id);
    invalidateLessons();
    expect(getLesson("notes-rollouts")).toMatchObject({ provenance: "mcp", focus: "what we learned about rollouts", url: "" });
    expect(lessonProblems().filter((p) => p.file === "notes-rollouts.md")).toEqual([]);
    expect(mgr.list().find((j) => j.id === id)).toMatchObject({ status: "adopted", source: { kind: "mcp", server: { name: "notes" } } });
  });

  it("a server named by its Claude Code configuration needs no command: the spec is resolved from ~/.claude.json", async () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "reins-claude-cfg-"));
    const prevCfg = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    fs.writeFileSync(path.join(cfgDir, ".claude.json"), JSON.stringify({ mcpServers: { notes: { command: "node", args: ["notes-server.js"], env: { NOTES: "/n" } } } }));
    try {
      const r = resolveSource({ mcp: { name: "notes" }, focus: "rollouts" }, "/tmp/job");
      expect(r.source).toEqual({ kind: "mcp", server: { name: "notes", command: "node", args: ["notes-server.js"], env: { NOTES: "/n" } } });
      expect(r.url).toBe("mcp://notes");
      expect(() => resolveSource({ mcp: { name: "missing" }, focus: "x" }, "/tmp/job")).toThrow(/no MCP server named "missing"/);
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevCfg;
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it("fails the job, not the server, when the MCP server cannot be reached", async () => {
    const mgr = new IntakeManager({ client: () => fakeClient([]).client, hasClaudeCode: () => false, mcpSource: async () => { throw new Error("connect ECONNREFUSED"); } });
    const { id } = mgr.start({ mcp: { name: "down", url: "http://127.0.0.1:1/mcp" }, focus: "anything" });
    await mgr.settled(id);
    expect(mgr.list().find((j) => j.id === id)).toMatchObject({ status: "failed", reason: "connect ECONNREFUSED" });
  });
});
