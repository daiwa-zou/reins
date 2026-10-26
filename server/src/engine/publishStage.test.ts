import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Orchestrator } from "./orchestrator.js";
import { Publisher } from "./publish.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";
import { call, collect, control, fakeClient, fakeGh, phasesOf, prView, tmpWorkspace, toolUse, withRemote, type Scripted } from "./scripted.js";

// The publish stage: every package is built on its own branch cut from the
// freshly pulled base; after evaluation passes the harness pushes, opens a
// pull request, waits until it is approved with green checks, merges it and
// pulls the base, so the next package starts from the merged tip.

const features = [
  { id: "F1", title: "hello file", status: "todo" },
  { id: "F2", title: "bye file", status: "todo" },
];
const packages = [
  { id: "P1", title: "Say hello", features: ["F1"], rationale: "r1", estimated_lines: 10, depends_on: [] },
  { id: "P2", title: "Say bye", features: ["F2"], rationale: "r2", estimated_lines: 10, depends_on: ["P1"] },
];
const noPauses = { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false, beforeMerge: false };
const cfgFor = (ws: string, extra: Record<string, unknown> = {}) =>
  defaultRunConfig({ id: "run1", task: "Greet", title: "Greet", workspace: ws, components: { testsFirst: false, osSandbox: false, actionClassifier: false } as any, pauses: noPauses, maxFixRounds: 0, publish: { remote: "origin", mergeWhen: "approved", mergeMethod: "squash", pollSeconds: 0, maxWaitMinutes: 60, maxReviewRounds: 3 }, ...extra });

const planner: Scripted[] = [
  { content: [toolUse("p1", "write_file", { path: ".reins/spec.md", content: "# spec" }), toolUse("p2", "update_progress", { features, note: "planned" })], stop_reason: "tool_use" },
  call("p3", "finish", { summary: "planned", open_items: [] }),
  call("bd", "propose_breakdown", { packages, rationale: "two" }),
];
const packageRound = (id: string, file: string): Scripted[] => [
  call(`${id}c1`, "propose_contract", { criteria: [{ id: `C${id}`, text: `${file} exists`, verify: `cat ${file}`, hard: true }], rationale: "r" }),
  call(`${id}c2`, "review_contract", { accept: true, criteria: [{ id: `C${id}`, text: `${file} exists`, verify: `cat ${file}`, hard: true }], feedback: "ok" }),
  { content: [toolUse(`${id}b1`, "write_file", { path: file, content: `${id}\n` }), toolUse(`${id}b2`, "update_progress", { features: [{ id: id === "P1" ? "F1" : "F2", title: "t", status: "done" }], note: "built" })], stop_reason: "tool_use" },
  call(`${id}b3`, "finish", { summary: "built", open_items: [] }),
  call(`${id}e1`, "report_evaluation", { results: [{ id: `C${id}`, pass: true, evidence: "seen" }], summary: `${id} ok` }),
];
const prEvents = (events: RunEvent[], type: "pr.opened" | "pr.merged") => events.filter((e) => e.type === type) as any[];
const remoteLog = (remote: string, ref: string) => execSync(`git --git-dir=${JSON.stringify(remote)} log --format=%s ${ref}`, { encoding: "utf8" }).trim().split("\n");

describe("the publish stage", () => {
  it("builds each package on a branch from the pulled base, opens a PR, waits for approval, merges, pulls, and starts the next package from the merged tip", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.waiting, prView.waiting, prView.approved], "2": [prView.approved] });
    const cfg = cfgFor(ws, { pauses: { ...noPauses, beforeMerge: true } });
    const { client, calls } = fakeClient([...planner, ...packageRound("P1", "hello.txt"), ...packageRound("P2", "bye.txt")]);
    const bus = new RunBus("t-publish", false);
    const events = collect(bus);
    const approvals: { title: string; payload: any }[] = [];
    const orch = new Orchestrator(client, cfg, bus, control({ requestPhaseApproval: async (title, _d, payload) => (approvals.push({ title, payload }), { approved: true }) }), { publisher: new Publisher({ gh: gh.command }) });
    const r = await orch.run();
    expect(r.summary).toBe("P2 ok");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(13);
    expect(phasesOf(events).map((p) => `${p.phase}${p.package ? ":" + p.package.id : ""}`)).toEqual(["plan", "breakdown", "contract:P1", "build:P1", "evaluate:P1", "publish:P1", "contract:P2", "build:P2", "evaluate:P2", "publish:P2", "wrapup"]);

    // Two PRs, each from its own branch onto the base.
    const st = gh.read();
    expect(Object.values(st.prs).map((p) => [p.number, p.base, p.head, p.title, p.state, p.method])).toEqual([
      [1, base, "reins/run1-p1-say-hello", "Say hello", "MERGED", "--squash"],
      [2, base, "reins/run1-p2-say-bye", "Say bye", "MERGED", "--squash"],
    ]);
    expect(st.prs["1"].body).toContain("## Work package P1: Say hello");
    expect(st.prs["1"].body).toContain("| CP1 | hard | hello.txt exists | `cat hello.txt` | PASS | seen |");
    expect(st.calls.filter((c) => c[1] === "view" && c[2] === "1")).toHaveLength(3); // waited twice, then approved
    const opened = prEvents(events, "pr.opened");
    expect(opened.map((e) => [e.number, e.url, e.branch, e.base, e.package?.id])).toEqual([
      [1, "https://example.test/pr/1", "reins/run1-p1-say-hello", base, "P1"],
      [2, "https://example.test/pr/2", "reins/run1-p2-say-bye", base, "P2"],
    ]);
    const merged = prEvents(events, "pr.merged");
    expect(merged.map((e) => e.number)).toEqual([1, 2]);
    expect(merged[0].sha).toMatch(/^[0-9a-f]{40}$/);

    // The merge pause fires per PR and names it.
    expect(approvals.map((a) => a.title)).toEqual(["Merge pull request #1?", "Merge pull request #2?"]);
    expect(approvals[0].payload).toMatchObject({ number: 1, url: "https://example.test/pr/1", branch: "reins/run1-p1-say-hello" });

    // The remote's base holds both builds in order, P2 on top of P1: the second package was cut from the merged tip.
    expect(remoteLog(remote, base)).toEqual(["reins: build P2 — Say bye", "reins: build P1 — Say hello", "init"]);
    expect(merged[1].sha).toBe(execSync(`git --git-dir=${JSON.stringify(remote)} rev-parse ${base}`, { encoding: "utf8" }).trim());
    // The workspace is back on the base, up to date and clean, with the package branches gone.
    expect(execSync("git rev-parse --abbrev-ref HEAD", { cwd: ws, encoding: "utf8" }).trim()).toBe(base);
    expect(execSync("git rev-parse HEAD", { cwd: ws, encoding: "utf8" }).trim()).toBe(merged[1].sha);
    expect(execSync("git status --short", { cwd: ws, encoding: "utf8" }).trim()).toBe("");
    expect(execSync("git branch --list 'reins/*'", { cwd: ws, encoding: "utf8" }).trim()).toBe("");
    expect(fs.existsSync(path.join(ws, "hello.txt")) && fs.existsSync(path.join(ws, "bye.txt"))).toBe(true);
    const notes = events.filter((e): e is Extract<RunEvent, { type: "note" }> => e.type === "note").map((e) => e.text);
    expect(notes.some((t) => /Publishing to origin/.test(t))).toBe(true);
    expect(notes.some((t) => /Branch reins\/run1-p2-say-bye cut from .* at [0-9a-f]{7}/.test(t))).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("without a remote the stage is skipped with one note and the run is as before", async () => {
    const ws = tmpWorkspace();
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const bus = new RunBus("t-noremote", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control(), { publisher: new Publisher({ gh: "false" }) }).run();
    expect(r.ok).toBe(true);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["contract", "build", "evaluate", "wrapup"]);
    const skip = events.filter((e): e is Extract<RunEvent, { type: "note" }> => e.type === "note" && /Publish skipped/.test(e.text));
    expect(skip).toHaveLength(1);
    expect(skip[0].text).toMatch(/no git remote "origin"/);
    expect(execSync("git rev-parse --abbrev-ref HEAD", { cwd: ws, encoding: "utf8" }).trim()).toBe("main");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("without a gh login the stage is skipped too", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const bus = new RunBus("t-nogh", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control(), { publisher: new Publisher({ gh: "false" }) }).run();
    expect(r.ok).toBe(true);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["contract", "build", "evaluate", "wrapup"]);
    expect(events.some((e) => e.type === "note" && /Publish skipped: gh is not logged in/.test(e.text))).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("a PR closed without merging fails the run and names it", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.waiting, prView.closed] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const bus = new RunBus("t-closed", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Pull request #1 (https://example.test/pr/1) was closed without being merged.");
    expect(prEvents(events, "pr.merged")).toHaveLength(0);
    // the implicit single package still got its own branch and PR
    expect(gh.read().prs["1"].head).toBe("reins/run1-p1-greet");
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("failing checks fail the run naming the checks (review rounds come later)", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.failing] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const r = await new Orchestrator(client, cfg, new RunBus("t-failing", false), control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Pull request #1 (https://example.test/pr/1) has failing checks: ci.");
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("gives up after maxWaitMinutes with the reason it was still waiting", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.waiting] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, publish: { remote: "origin", mergeWhen: "approved", mergeMethod: "squash", pollSeconds: 0, maxWaitMinutes: 0, maxReviewRounds: 3 } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const r = await new Orchestrator(client, cfg, new RunBus("t-wait", false), control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Pull request #1 (https://example.test/pr/1) was not merged after 0 minutes (checks pending: ci). It stays open; merge it and start the next package with a new run.");
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("mergeWhen never opens the PR and stacks the next package on this branch without waiting", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws);
    const cfg = cfgFor(ws, { publish: { remote: "origin", mergeWhen: "never", mergeMethod: "squash", pollSeconds: 0, maxWaitMinutes: 60, maxReviewRounds: 3 } });
    const { client } = fakeClient([...planner, ...packageRound("P1", "hello.txt"), ...packageRound("P2", "bye.txt")]);
    const bus = new RunBus("t-never", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    const st = gh.read();
    expect(Object.values(st.prs).map((p) => [p.base, p.head, p.state])).toEqual([
      [base, "reins/run1-p1-say-hello", "OPEN"],
      ["reins/run1-p1-say-hello", "reins/run1-p2-say-bye", "OPEN"],
    ]);
    expect(st.calls.some((c) => c[1] === "view" || c[1] === "merge")).toBe(false);
    expect(prEvents(events, "pr.merged")).toHaveLength(0);
    expect(remoteLog(remote, "reins/run1-p2-say-bye")).toEqual(["reins: build P2 — Say bye", "reins: build P1 — Say hello", "init"]);
    expect(remoteLog(remote, base)).toEqual(["init"]);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("a rejected merge pause stops the run with the PR open", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.approved] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, pauses: { ...noPauses, beforeMerge: true } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const r = await new Orchestrator(client, cfg, new RunBus("t-reject", false), control({ requestPhaseApproval: async () => ({ approved: false, note: "not yet" }) }), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Merge of pull request #1 (https://example.test/pr/1) rejected: not yet. It stays open.");
    expect(gh.read().prs["1"].state).toBe("OPEN");
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });
});
