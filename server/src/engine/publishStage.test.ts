import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Orchestrator } from "./orchestrator.js";
import { Publisher } from "./publish.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";
import { call, collect, comment, control, fakeClient, fakeGh, inlineComment, lastUserText, phasesOf, prView, review, tmpWorkspace, toolUse, withRemote, type Scripted } from "./scripted.js";

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

  it("with no review rounds allowed, failing checks fail the run naming the checks", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.failing] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, publish: { remote: "origin", mergeWhen: "approved", mergeMethod: "squash", pollSeconds: 0, maxWaitMinutes: 60, maxReviewRounds: 0 } });
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const r = await new Orchestrator(client, cfg, new RunBus("t-failing", false), control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Pull request #1 (https://example.test/pr/1) still has failing checks (ci) after 0 review rounds. It stays open.");
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

  it("the beforePublish pause shows the pull request draft before the branch is pushed, and a rejection leaves the branch local", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.approved] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, pauses: { ...noPauses, beforePublish: true } });
    const asked: { draft: any; detail: any }[] = [];
    const { client } = fakeClient([...packageRound("P1", "hello.txt")]);
    const bus = new RunBus("t-prepublish", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control({ requestPublishApproval: async (draft, detail) => (asked.push({ draft, detail }), { decision: "reject", note: "not today" }) }), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Publishing rejected: not today. The branch reins/run1-p1-greet stays local and unpushed.");
    expect(asked).toHaveLength(1);
    expect(asked[0].detail).toMatchObject({ branch: "reins/run1-p1-greet", base, revision: 0 });
    expect(asked[0].draft.title).toBe("Greet");
    expect(asked[0].draft.body).toContain("## Definition of done");
    expect(gh.read().prs).toEqual({});
    expect(remoteLog(remote, base)).toEqual(["init"]);
    expect(prEvents(events, "pr.opened")).toHaveLength(0);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });

  it("requesting changes sends the draft and the note to the builder, which redrafts; the edited, approved draft opens the pull request", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.approved] });
    const cfg = cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, pauses: { ...noPauses, beforePublish: true } });
    const asked: { draft: any; detail: any }[] = [];
    const { client, calls } = fakeClient([
      ...packageRound("P1", "hello.txt"),
      // The builder's redraft, after the reviewer's note.
      (params) => {
        const text = lastUserText(params);
        expect(text).toContain("Reviewer's note");
        expect(text).toContain("make it shorter");
        expect(text).toContain("Current draft");
        return { content: [toolUse("pr1", "propose_pr", { title: "Add hello.txt", body: "Adds the greeting file.\n\nVerified: cat hello.txt" })], stop_reason: "tool_use" };
      },
    ]);
    const answers: any[] = [{ decision: "revise", note: "make it shorter" }, { decision: "approve", draft: { title: "Add hello.txt (P1)", body: "Adds the greeting file.\n\nVerified: cat hello.txt\n\nEdited by the reviewer." } }];
    const bus = new RunBus("t-revise", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control({ requestPublishApproval: async (draft, detail) => (asked.push({ draft, detail }), answers.shift()) }), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(6);
    expect(asked.map((a) => a.detail.revision)).toEqual([0, 1]);
    expect(asked[1].draft).toEqual({ title: "Add hello.txt", body: "Adds the greeting file.\n\nVerified: cat hello.txt" });
    const pr = gh.read().prs["1"];
    expect(pr.title).toBe("Add hello.txt (P1)");
    expect(pr.body).toContain("Edited by the reviewer.");
    expect(prEvents(events, "pr.opened")).toHaveLength(1);
    // The redraft's model turns are counted inside the publish phase.
    const publish = events.find((e) => e.type === "phase.finished" && e.phase === "publish") as Extract<RunEvent, { type: "phase.finished" }>;
    expect(publish.usage.input).toBeGreaterThan(0);
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

describe("review rounds on the pull request", () => {
  // A review round is a work package of its own: contract, (tests,) build and
  // evaluate run again for the feedback, then the reply goes out with the push.
  const single = (ws: string, extra: Record<string, unknown> = {}) => cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, ...extra });
  const feedbackEvents = (events: RunEvent[]) => events.filter((e) => e.type === "pr.feedback") as any[];
  const reviewRound = (n: number, file: string, content: string, summary: string, onBuild?: (brief: string) => void): Scripted[] => [
    call(`r${n}c1`, "propose_contract", { criteria: [{ id: `R${n}C1`, text: "feedback addressed", verify: `cat ${file}`, hard: true }], rationale: "r" }),
    call(`r${n}c2`, "review_contract", { accept: true, criteria: [{ id: `R${n}C1`, text: "feedback addressed", verify: `cat ${file}`, hard: true }], feedback: "ok" }),
    (params) => {
      onBuild?.(lastUserText(params));
      expect(params.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(["edit_file", "bash", "finish"]));
      return { content: [toolUse(`r${n}b1`, "write_file", { path: file, content, overwrite: true })], stop_reason: "tool_use" } as any;
    },
    call(`r${n}b2`, "finish", { summary, open_items: [] }),
    call(`r${n}e1`, "report_evaluation", { results: [{ id: `R${n}C1`, pass: true, evidence: "seen" }], summary: `round ${n} ok` }),
  ];
  const cleanup = (ws: string, remote: string) => {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  };

  it("a failing check and review comments start a review round that runs contract, build and evaluate as its own package, commits, pushes and replies, then the PR is merged", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.failing, comments: [comment("ana", "Please also greet in uppercase.")], reviews: [review("bo", "COMMENTED", "Looks close.")] }, prView.approved] }, { "1": [[inlineComment("ana", "hello.txt", 1, "Trailing newline missing?")], []] });
    const cfg = single(ws);
    let brief = "";
    let contractBrief = "";
    const { client, calls } = fakeClient([
      ...packageRound("P1", "hello.txt"),
      (params) => ((contractBrief = lastUserText(params)), call("r1c1", "propose_contract", { criteria: [{ id: "R1C1", text: "uppercase greeting", verify: "cat hello.txt", hard: true }], rationale: "r" })) as any,
      call("r1c2", "review_contract", { accept: true, criteria: [{ id: "R1C1", text: "uppercase greeting", verify: "cat hello.txt", hard: true }], feedback: "ok" }),
      (params) => {
        brief = lastUserText(params);
        return { content: [toolUse("r1b1", "write_file", { path: "hello.txt", content: "HELLO\n", overwrite: true })], stop_reason: "tool_use" } as any;
      },
      call("r1b2", "finish", { summary: "Greeting is uppercase now; ci passes locally.", open_items: [] }),
      call("r1e1", "report_evaluation", { results: [{ id: "R1C1", pass: true, evidence: "HELLO seen" }], summary: "uppercase verified" }),
    ]);
    const bus = new RunBus("t-review", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.summary).toBe("P1 ok");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(10);
    // The round's phases are a package of their own (R1), between two publish phases: round 0 opens and waits, round 1 pushes the reply and waits again.
    expect(phasesOf(events).map((p) => [p.phase, p.round, p.package?.id ?? null])).toEqual([
      ["contract", 0, null],
      ["build", 1, null],
      ["evaluate", 1, null],
      ["publish", 0, null],
      ["contract", 0, "R1"],
      ["build", 1, "R1"],
      ["evaluate", 1, "R1"],
      ["publish", 1, null],
      ["wrapup", 0, null],
    ]);
    expect(phasesOf(events)[4].package).toEqual({ id: "R1", title: "Review round 1 of Greet", index: 1, total: 1 });

    // The contract builder and the builder both got every piece of feedback, the failing check, and the package's original contract.
    for (const text of [contractBrief, brief]) {
      expect(text).toContain("# Review feedback");
      expect(text).toContain("- @ana commented: Please also greet in uppercase.");
      expect(text).toContain("- @bo commented: Looks close.");
      expect(text).toContain("- @ana on hello.txt:1: Trailing newline missing?");
      expect(text).toContain("- ci (fail)");
      expect(text).toContain("# Original contract");
      expect(text).toContain("CP1: hello.txt exists");
      expect(text).toContain("# Work package\nR1 of 1: Review round 1 of Greet");
    }
    expect(contractBrief).toMatch(/# Phase\ncontract/);
    expect(brief).toMatch(/# Phase\nbuild/);
    expect(brief).toContain("# Contract");
    expect(brief).toContain("R1C1: uppercase greeting");

    const fb = feedbackEvents(events);
    expect(fb.map((e) => [e.number, e.round, e.comments, e.checks])).toEqual([[1, 1, 3, ["ci"]]]);
    expect(fb[0].summary).toContain("Greeting is uppercase now; ci passes locally.");
    expect(fb[0].addressed).toBeUndefined();
    // The round was committed as its own package and pushed before the merge, and the reply posted with the marker.
    expect(remoteLog(remote, base)).toEqual(["reins: build R1 — Review round 1 of Greet", "reins: build — Greet", "init"]);
    const st = gh.read();
    expect(st.comments).toHaveLength(1);
    expect(st.comments[0].body).toMatch(/^<!-- reins -->/);
    expect(st.comments[0].body).toContain("Greeting is uppercase now; ci passes locally.");
    expect(st.comments[0].body).toContain("review round 1");
    expect(st.comments[0].body).toContain("uppercase verified");
    expect(st.prs["1"].state).toBe("MERGED");
    expect(fs.readFileSync(path.join(ws, "hello.txt"), "utf8")).toBe("HELLO\n");
    cleanup(ws, remote);
  });

  it("requested changes with a body start a round even when checks are green", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.checksOnly, reviewDecision: "CHANGES_REQUESTED", reviews: [review("bo", "CHANGES_REQUESTED", "Add a bye file too.")] }, prView.approved] });
    let brief = "";
    const { client } = fakeClient([...packageRound("P1", "hello.txt"), ...reviewRound(1, "bye.txt", "bye\n", "Added bye.txt.", (b) => (brief = b))]);
    const bus = new RunBus("t-changes", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, single(ws), bus, control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(brief).toContain("- @bo requested changes: Add a bye file too.");
    expect(brief).not.toContain("Failing checks");
    expect(feedbackEvents(events).map((e) => [e.round, e.comments, e.checks])).toEqual([[1, 1, []]]);
    cleanup(ws, remote);
  });

  it("the harness's own replies and old comments do not start a round", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.approved, comments: [comment("reins", "<!-- reins -->\nEarlier reply."), comment("ana", "From last week.", "2000-01-01T00:00:00Z")] }] });
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt")]);
    const bus = new RunBus("t-own", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, single(ws), bus, control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(5);
    expect(feedbackEvents(events)).toHaveLength(0);
    expect(gh.read().prs["1"].state).toBe("MERGED");
    cleanup(ws, remote);
  });

  it("gives up after maxReviewRounds with the feedback still open", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [prView.failing] });
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt"), ...reviewRound(1, "hello.txt", "tried\n", "Tried.")]);
    const cfg = single(ws, { publish: { remote: "origin", mergeWhen: "approved", mergeMethod: "squash", pollSeconds: 0, maxWaitMinutes: 60, maxReviewRounds: 1 } });
    const bus = new RunBus("t-rounds", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control(), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(10);
    expect(r.summary).toBe("Pull request #1 (https://example.test/pr/1) still has failing checks (ci) after 1 review round. It stays open.");
    expect(feedbackEvents(events)).toHaveLength(1);
    cleanup(ws, remote);
  });

  it("with the planner on, a review round plans first: the planner writes .reins/review-plan.md from the feedback, the afterPlan pause shows it, and the contract builder gets it", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.checksOnly, reviewDecision: "CHANGES_REQUESTED", reviews: [review("bo", "CHANGES_REQUESTED", "Add a bye file too.")] }, prView.approved] });
    const cfg = cfgFor(ws, { components: { planner: true, workPackages: false, testsFirst: false, osSandbox: false, actionClassifier: false }, pauses: { ...noPauses, afterPlan: true } });
    let planBrief = "";
    let contractBrief = "";
    const { client, calls } = fakeClient([
      ...planner.slice(0, 2),
      ...packageRound("P1", "hello.txt"),
      (params) => ((planBrief = lastUserText(params)), { content: [toolUse("rp1", "write_file", { path: ".reins/review-plan.md", content: "# Review plan\n\n- @bo: add bye.txt with a farewell.\n" })], stop_reason: "tool_use" }) as any,
      call("rp2", "finish", { summary: "planned the round", open_items: [] }),
      ...reviewRound(1, "bye.txt", "bye\n", "Added bye.txt.", (b) => (contractBrief = b)),
    ]);
    const asked: { title: string; payload: any }[] = [];
    const bus = new RunBus("t-review-plan", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control({ requestPhaseApproval: async (title, _detail, payload) => (asked.push({ title, payload }), { approved: true }) }), { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2 + 5 + 2 + 5);
    expect(phasesOf(events).map((p) => [p.phase, p.package?.id ?? null])).toEqual([
      ["plan", null],
      ["contract", null],
      ["build", null],
      ["evaluate", null],
      ["publish", null],
      ["plan", "R1"],
      ["contract", "R1"],
      ["build", "R1"],
      ["evaluate", "R1"],
      ["publish", null],
      ["wrapup", null],
    ]);
    expect(planBrief).toContain("- @bo requested changes: Add a bye file too.");
    expect(planBrief).toContain(".reins/review-plan.md");
    expect(planBrief).not.toContain("update_progress");
    // The plan pause shows the review plan, not the package spec.
    expect(asked.map((a) => a.title)).toEqual(["Review the plan", "Review the plan for review round 1"]);
    expect(asked[1].payload.spec).toContain("add bye.txt with a farewell");
    expect(contractBrief).toContain("# Review plan");
    expect(contractBrief).toContain("add bye.txt with a farewell");
    expect(fs.readFileSync(path.join(ws, ".reins/spec.md"), "utf8")).toBe("# spec");
    cleanup(ws, remote);
  });
});

describe("the person in the review loop", () => {
  const single = (ws: string, pauses: Record<string, boolean>) => cfgFor(ws, { components: { planner: false, testsFirst: false, osSandbox: false, actionClassifier: false }, pauses: { ...noPauses, ...pauses } });
  const feedbackEvents = (events: RunEvent[]) => events.filter((e) => e.type === "pr.feedback") as any[];
  const roundCalls = (n: number, file: string, summary: string, onBuild?: (brief: string) => void): Scripted[] => [
    call(`r${n}c1`, "propose_contract", { criteria: [{ id: `R${n}C1`, text: "feedback addressed", verify: `cat ${file}`, hard: true }], rationale: "r" }),
    call(`r${n}c2`, "review_contract", { accept: true, criteria: [{ id: `R${n}C1`, text: "feedback addressed", verify: `cat ${file}`, hard: true }], feedback: "ok" }),
    (params) => (onBuild?.(lastUserText(params)), { content: [toolUse(`r${n}b1`, "write_file", { path: file, content: `${summary}\n`, overwrite: true })], stop_reason: "tool_use" }) as any,
    call(`r${n}b2`, "finish", { summary, open_items: [] }),
    call(`r${n}e1`, "report_evaluation", { results: [{ id: `R${n}C1`, pass: true, evidence: "seen" }], summary: `round ${n} verified` }),
  ];
  const threeItems = (ws: string) =>
    fakeGh(ws, { "1": [{ ...prView.failing, comments: [comment("ana", "Please also greet in uppercase.")], reviews: [review("bo", "COMMENTED", "Nit: typo in the README.")] }, prView.approved] }, { "1": [[inlineComment("ana", "hello.txt", 1, "Trailing newline missing?")], []] });
  const cleanup = (ws: string, remote: string) => {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  };

  it("beforeReviewRound shows every comment and failing check, and only the kept items reach the round", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = threeItems(ws);
    let brief = "";
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt"), ...roundCalls(1, "hello.txt", "HELLO", (b) => (brief = b))]);
    const asked: any[] = [];
    const bus = new RunBus("t-review-card", false);
    const events = collect(bus);
    const ctl = control({ requestReviewApproval: async (payload) => (asked.push(payload), { decision: "approve", keep: [0, 2, 3] }) });
    const r = await new Orchestrator(client, single(ws, { beforeReviewRound: true }), bus, ctl, { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(10);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ number: 1, url: "https://example.test/pr/1", round: 1, maxRounds: 3 });
    // Items are numbered in the order shown: comments, reviews and inline comments by time, then the failing checks.
    expect(asked[0].items.map((i: any) => [i.kind, i.author, i.body])).toEqual([
      ["comment", "ana", "Please also greet in uppercase."],
      ["review", "bo", "Nit: typo in the README."],
      ["inline", "ana", "Trailing newline missing?"],
    ]);
    expect(asked[0].checks.map((c: any) => c.name)).toEqual(["ci"]);
    // The skipped review (index 1) is not in the brief; the kept comment, inline comment and check are.
    expect(brief).toContain("Please also greet in uppercase.");
    expect(brief).toContain("Trailing newline missing?");
    expect(brief).toContain("- ci (fail)");
    expect(brief).not.toContain("typo in the README");
    expect(feedbackEvents(events).map((e) => [e.round, e.comments, e.checks, e.addressed])).toEqual([[1, 2, ["ci"], { kept: 3, of: 4 }]]);
    expect(gh.read().prs["1"].state).toBe("MERGED");
    cleanup(ws, remote);
  });

  it("skipping the feedback keeps waiting without a round; a skipped failing check does not ask again, and a run that then merges is fine", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    // Three looks: feedback, the same failing check and nothing new, then approved.
    const gh = fakeGh(ws, { "1": [{ ...prView.failing, comments: [comment("ana", "Please also greet in uppercase.")] }, prView.failing, prView.approved] });
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt")]);
    const asked: any[] = [];
    const bus = new RunBus("t-skip", false);
    const events = collect(bus);
    const ctl = control({ requestReviewApproval: async (payload) => (asked.push(payload), { decision: "revise", note: "not worth a round" }) });
    const r = await new Orchestrator(client, single(ws, { beforeReviewRound: true }), bus, ctl, { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(5);
    expect(asked).toHaveLength(1);
    expect(feedbackEvents(events)).toHaveLength(0);
    const skipped = events.filter((e) => e.type === "pr.skipped") as any[];
    expect(skipped.map((e) => [e.number, e.comments, e.checks, e.note])).toEqual([[1, 1, ["ci"], "not worth a round"]]);
    expect(remoteLog(remote, base)).toEqual(["reins: build — Greet", "init"]);
    expect(gh.read().comments).toHaveLength(0);
    expect(gh.read().prs["1"].state).toBe("MERGED");
    cleanup(ws, remote);
  });

  it("stopping at the review card fails the run with the pull request open and nothing pushed", async () => {
    const ws = tmpWorkspace();
    const { remote } = withRemote(ws);
    const gh = threeItems(ws);
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt")]);
    const bus = new RunBus("t-review-stop", false);
    const ctl = control({ requestReviewApproval: async () => ({ decision: "reject", note: "I will handle these myself" }) });
    const r = await new Orchestrator(client, single(ws, { beforeReviewRound: true }), bus, ctl, { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(5);
    expect(r.summary).toBe("Pull request #1 (https://example.test/pr/1) has review feedback you chose not to address: I will handle these myself. It stays open.");
    expect(gh.read().prs["1"].state).toBe("OPEN");
    cleanup(ws, remote);
  });

  it("beforeReviewReply shows the reply with the round's files and commits before anything is pushed; approving pushes the edited reply", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.checksOnly, reviewDecision: "CHANGES_REQUESTED", reviews: [review("bo", "CHANGES_REQUESTED", "Add a bye file too.")] }, prView.approved] });
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt"), ...roundCalls(1, "bye.txt", "Added bye.txt.")]);
    const asked: any[] = [];
    let pushedAtAsk: string[] = [];
    const bus = new RunBus("t-reply", false);
    const events = collect(bus);
    const ctl = control({
      requestReplyApproval: async (payload) => {
        asked.push(payload);
        pushedAtAsk = remoteLog(remote, "reins/run1-p1-greet");
        return { decision: "approve", reply: `${payload.reply}\n\nEdited by the reviewer.` };
      },
    });
    const r = await new Orchestrator(client, single(ws, { beforeReviewReply: true }), bus, ctl, { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(10);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ number: 1, round: 1, revision: 0 });
    expect(asked[0].reply).toContain("Added bye.txt.");
    expect(asked[0].reply).toContain("round 1 verified");
    expect(asked[0].files).toEqual(["bye.txt"]);
    expect(asked[0].commits).toHaveLength(1);
    expect(asked[0].commits[0]).toMatch(/^[0-9a-f]{7} reins: build R1 — Review round 1 of Greet$/);
    // The round had not been pushed to the branch while the card was up; the edited reply went out with the push.
    expect(pushedAtAsk).toEqual(["reins: build — Greet", "init"]);
    expect(remoteLog(remote, base)).toEqual(["reins: build R1 — Review round 1 of Greet", "reins: build — Greet", "init"]);
    expect(gh.read().comments[0].body).toContain("Edited by the reviewer.");
    expect(feedbackEvents(events)[0].summary).toContain("Edited by the reviewer.");
    cleanup(ws, remote);
  });

  it("rejecting the reply leaves the round's commits local and ends the run with the pull request open", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.checksOnly, reviewDecision: "CHANGES_REQUESTED", reviews: [review("bo", "CHANGES_REQUESTED", "Add a bye file too.")] }, prView.approved] });
    const { client } = fakeClient([...packageRound("P1", "hello.txt"), ...roundCalls(1, "bye.txt", "Added bye.txt.")]);
    const bus = new RunBus("t-reply-reject", false);
    const ctl = control({ requestReplyApproval: async () => ({ decision: "reject", note: "wrong approach" }) });
    const r = await new Orchestrator(client, single(ws, { beforeReviewReply: true }), bus, ctl, { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Review round 1 on pull request #1 (https://example.test/pr/1) was not pushed: wrong approach. Its commits stay local on reins/run1-p1-greet; the pull request stays open.");
    expect(remoteLog(remote, base)).toEqual(["init"]);
    expect(remoteLog(remote, "reins/run1-p1-greet")).toEqual(["reins: build — Greet", "init"]);
    expect(execSync("git log --format=%s", { cwd: ws, encoding: "utf8" }).trim().split("\n")[0]).toBe("reins: build R1 — Review round 1 of Greet");
    expect(gh.read().comments).toHaveLength(0);
    expect(gh.read().prs["1"].state).toBe("OPEN");
    cleanup(ws, remote);
  });

  it("requesting changes on the reply sends the note back as feedback and the round runs again through the workflow", async () => {
    const ws = tmpWorkspace();
    const { remote, base } = withRemote(ws);
    const gh = fakeGh(ws, { "1": [{ ...prView.checksOnly, reviewDecision: "CHANGES_REQUESTED", reviews: [review("bo", "CHANGES_REQUESTED", "Add a bye file too.")] }, prView.approved] });
    let secondBrief = "";
    const { client, calls } = fakeClient([...packageRound("P1", "hello.txt"), ...roundCalls(1, "bye.txt", "Added bye.txt."), ...roundCalls(1, "bye.txt", "Added bye.txt with a farewell.", (b) => (secondBrief = b))]);
    const asked: any[] = [];
    const answers: any[] = [{ decision: "revise", note: "say goodbye properly, not just bye" }, { decision: "approve" }];
    const bus = new RunBus("t-reply-revise", false);
    const events = collect(bus);
    const ctl = control({ requestReplyApproval: async (payload) => (asked.push(payload), answers.shift()) });
    const r = await new Orchestrator(client, single(ws, { beforeReviewReply: true }), bus, ctl, { publisher: new Publisher({ gh: gh.command }) }).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(15);
    expect(asked.map((a) => a.revision)).toEqual([0, 1]);
    expect(asked[1].reply).toContain("Added bye.txt with a farewell.");
    expect(secondBrief).toContain("- @bo requested changes: Add a bye file too.");
    expect(secondBrief).toContain("- @you commented: say goodbye properly, not just bye");
    expect(phasesOf(events).filter((p) => p.package?.id === "R1").map((p) => [p.phase, p.package!.title])).toEqual([
      ["contract", "Review round 1 of Greet"],
      ["build", "Review round 1 of Greet"],
      ["evaluate", "Review round 1 of Greet"],
      ["contract", "Review round 1 of Greet (revision 1)"],
      ["build", "Review round 1 of Greet (revision 1)"],
      ["evaluate", "Review round 1 of Greet (revision 1)"],
    ]);
    expect(remoteLog(remote, base)[0]).toBe("reins: build R1 — Review round 1 of Greet (revision 1)");
    expect(gh.read().comments).toHaveLength(1);
    expect(feedbackEvents(events)).toHaveLength(1);
    cleanup(ws, remote);
  });
});
