// Test kit for driving the loop and the orchestrator against a scripted
// stand-in for the Messages API. Not a test file: vitest only picks up *.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { LoopControl } from "./loop.js";
import type { OrchestratorControl } from "./orchestrator.js";
import { RunBus } from "./bus.js";
import type { RunEvent } from "../../../shared/types.js";

/**
 * Each call pops the next scripted response; a `fn` response can look at the
 * request (tools offered, messages so far) and assert on it.
 */
export type Scripted = Partial<Anthropic.Beta.BetaMessage> | ((params: any) => Partial<Anthropic.Beta.BetaMessage>);

export function fakeClient(script: Scripted[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: any) => {
          calls.push(params);
          const next = script.shift();
          if (!next) throw new Error(`script exhausted after ${calls.length} calls`);
          const body = typeof next === "function" ? next(params) : next;
          const msg: Anthropic.Beta.BetaMessage = {
            id: "msg",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } as any,
            ...body,
          } as any;
          return { finalMessage: async () => msg };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

export const toolUse = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input }) as any;
export const text = (t: string) => ({ type: "text", text: t }) as any;
/** A one-call response that calls one tool. */
export const call = (id: string, name: string, input: any): Scripted => ({ content: [toolUse(id, name, input)], stop_reason: "tool_use" });

export function control(overrides: Partial<OrchestratorControl> = {}): OrchestratorControl {
  const base: LoopControl = {
    signal: new AbortController().signal,
    waitIfPaused: async () => {},
    requestApproval: async () => ({ approved: true }),
    drainSteer: () => [],
    remainingBudget: () => 100,
  };
  return { ...base, requestPhaseApproval: async () => ({ approved: true }), requestContractApproval: async (c) => ({ approved: true, criteria: c }), requestPublishApproval: async (draft) => ({ decision: "approve", draft }), requestReviewApproval: async () => ({ decision: "approve" }), requestReplyApproval: async (p) => ({ decision: "approve", reply: p.reply }), ...overrides };
}

/** A git repo with a README and a package.json whose test script passes. */
export function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reins-ws-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# Sample\n");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "echo ok" } }));
  execSync("git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init", { cwd: dir });
  return dir;
}

export function collect(bus: RunBus) {
  const events: RunEvent[] = [];
  bus.on("event", (e: RunEvent) => events.push(e));
  return events;
}

/** The last user message of a request as a string (the phase's first message, or a tool result batch). */
export function lastUserText(params: any): string {
  const m = [...params.messages].reverse().find((x: any) => x.role === "user");
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return m.content.map((b: any) => (typeof b.content === "string" ? b.content : b.text ?? JSON.stringify(b))).join("\n");
}

export const phasesOf = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "phase.started" }> => e.type === "phase.started");

// ---- Publishing: a bare-repo remote and a fake gh ---------------------------

/** Turn a tmpWorkspace into a clone of a bare "remote" at ../remote.git, with origin set and the base branch pushed. Returns the base branch name. */
export function withRemote(ws: string): { remote: string; base: string } {
  const remote = path.join(path.dirname(ws), `${path.basename(ws)}-remote.git`);
  execSync(`git init -q --bare ${JSON.stringify(remote)}`);
  const base = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ws, encoding: "utf8" }).trim();
  execSync(`git remote add origin ${JSON.stringify(remote)} && git push -q -u origin ${base}`, { cwd: ws });
  return { remote, base };
}

/**
 * A fake `gh` for tests: a node script that records every call in a state
 * file, numbers pull requests as they are created, answers `pr view` from a
 * per-PR queue of scripted views (the last one repeats), and on `pr merge`
 * pushes the head branch onto the base in the real remote, so the harness's
 * pull afterwards is a real fast-forward. Returns the command to run it and
 * the state file path.
 */
export function fakeGh(_ws: string, views: Record<string, object[]> = {}, inline: Record<string, object[][]> = {}): { command: string; state: string; read: () => FakeGhState } {
  // Its files live outside the workspace, or the build's `git add -A` would commit them.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reins-gh-"));
  const state = path.join(dir, "gh-state.json");
  const script = path.join(dir, "fake-gh.mjs");
  fs.writeFileSync(state, JSON.stringify({ next: 1, prs: {}, views, inline, lastView: {}, calls: [], comments: [] }, null, 2));
  fs.writeFileSync(
    script,
    `import fs from "node:fs";
import { execSync } from "node:child_process";
const STATE = ${JSON.stringify(state)};
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const args = process.argv.slice(2);
st.calls.push(args);
const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prOf = (ref) => { const m = String(ref).match(/(\\d+)$/); return m ? m[1] : ref; };
const [group, verb] = args;
if (group === "auth" && verb === "status") { save(); console.log("Logged in to github.com"); process.exit(0); }
if (group === "pr" && verb === "create") {
  const n = String(st.next++);
  const body = flag("--body-file") ? fs.readFileSync(flag("--body-file"), "utf8") : flag("--body") ?? "";
  st.prs[n] = { number: Number(n), url: "https://example.test/pr/" + n, base: flag("--base"), head: flag("--head"), title: flag("--title"), body, state: "OPEN" };
  save(); console.log(st.prs[n].url); process.exit(0);
}
if (group === "pr" && verb === "view") {
  const n = prOf(args[2]); const pr = st.prs[n];
  if (!pr) { console.error("no pull requests found for " + args[2]); process.exit(1); }
  const q = st.views[n] ?? [];
  const v = q.length > 1 ? q.shift() : q[0] ?? {};
  const full = { number: pr.number, url: pr.url, state: pr.state, mergedAt: null, reviewDecision: "", statusCheckRollup: [], mergeStateStatus: "CLEAN", headRefName: pr.head, baseRefName: pr.base, comments: [], reviews: [], ...v };
  st.lastView[n] = full;
  save();
  console.log(JSON.stringify(full));
  process.exit(0);
}
if (group === "pr" && verb === "checks") {
  const n = prOf(args[2]); const v = st.lastView[n] ?? {};
  const bucket = (c) => (c.__typename === "StatusContext" ? (c.state === "SUCCESS" ? "pass" : c.state === "PENDING" ? "pending" : "fail") : c.status !== "COMPLETED" ? "pending" : ["SUCCESS", "NEUTRAL"].includes(c.conclusion) ? "pass" : c.conclusion === "SKIPPED" ? "skipping" : "fail");
  const rows = (v.statusCheckRollup ?? []).map((c) => ({ name: c.name ?? c.context, bucket: bucket(c), link: "https://example.test/checks/" + (c.name ?? c.context), description: c.description ?? "" }));
  save(); console.log(JSON.stringify(rows)); process.exit(rows.some((r) => r.bucket === "fail") ? 1 : rows.some((r) => r.bucket === "pending") ? 8 : 0);
}
if (group === "api") {
  const m = String(args[1]).match(/pulls\\/(\\d+)\\/comments/);
  if (m) { const q = st.inline[m[1]] ?? []; const v = q.length > 1 ? q.shift() : q[0] ?? []; save(); console.log(JSON.stringify(v)); process.exit(0); }
}
if (group === "pr" && verb === "merge") {
  const n = prOf(args[2]); const pr = st.prs[n];
  execSync("git push -q origin " + pr.head + ":" + pr.base, { stdio: "pipe" });
  pr.state = "MERGED"; pr.method = args.find((a) => /^--(squash|merge|rebase)$/.test(a));
  save(); console.log("Merged pull request #" + n); process.exit(0);
}
if (group === "pr" && verb === "comment") { st.comments.push({ pr: prOf(args[2]), body: flag("--body") ?? (flag("--body-file") ? fs.readFileSync(flag("--body-file"), "utf8") : "") }); save(); console.log("https://example.test/pr/" + prOf(args[2]) + "#comment"); process.exit(0); }
save(); console.error("fake gh: unsupported " + args.join(" ")); process.exit(2);
`,
  );
  return { command: `node ${JSON.stringify(script)}`, state, read: () => JSON.parse(fs.readFileSync(state, "utf8")) };
}

export interface FakeGhState {
  next: number;
  prs: Record<string, { number: number; url: string; base: string; head: string; title: string; body: string; state: string; method?: string }>;
  views: Record<string, object[]>;
  inline: Record<string, object[][]>;
  calls: string[][];
  comments: { pr: string; body: string }[];
}

/** Scripted `gh pr view` answers. */
export const prView = {
  waiting: { state: "OPEN", reviewDecision: "", statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "IN_PROGRESS", conclusion: "" }] },
  approved: { state: "OPEN", reviewDecision: "APPROVED", statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }] },
  checksOnly: { state: "OPEN", reviewDecision: "", statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }] },
  failing: { state: "OPEN", reviewDecision: "", statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "FAILURE" }, { __typename: "StatusContext", context: "lint", state: "SUCCESS" }] },
  closed: { state: "CLOSED", reviewDecision: "" },
  merged: { state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" },
};
/** A time after any harness clock in a test, so the comment counts as new. */
export const LATER = "2099-01-01T00:00:00Z";
export const comment = (login: string, body: string, createdAt = LATER) => ({ author: { login }, body, createdAt, url: `https://example.test/c/${body.length}` });
export const review = (login: string, state: string, body: string, submittedAt = LATER) => ({ author: { login }, state, body, submittedAt });
export const inlineComment = (login: string, path: string, line: number, body: string, created_at = LATER) => ({ user: { login }, path, line, body, created_at, html_url: `https://example.test/i/${line}` });
