import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Orchestrator } from "./orchestrator.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";
import { call, collect, control, fakeClient, lastUserText, phasesOf, text, tmpWorkspace, toolUse, type Scripted } from "./scripted.js";

// The tests stage (TDD): after the contract, a test writer turns the criteria
// into failing tests and explains them; the harness confirms the suite is red
// before the build, and making it pass becomes a hard criterion.

const criteria = [
  { id: "C1", text: "hello.txt contains hello", verify: "grep hello hello.txt", hard: true },
  { id: "C2", text: "README mentions hello", verify: "grep hello README.md", hard: true },
];
// A shell "suite": red until the builder writes hello.txt and the README line.
const suite = 'grep -q hello hello.txt && grep -q hello README.md && echo "2 passed" || { echo "FAIL hello.test.sh"; exit 1; }';
const plan = {
  command: "sh tests/hello.test.sh",
  tests: [
    { id: "T1", file: "tests/hello.test.sh", name: "hello.txt says hello", criteria: ["C1"], kind: "behavior", explains: "Reads the file a user would read; fails until it exists with the word." },
    { id: "T2", file: "tests/hello.test.sh", name: "README mentions hello", criteria: ["C2"], kind: "behavior", explains: "Documentation is part of done." },
  ],
  uncovered: [],
  explanation: "Two behaviour checks in one script, run by the command.",
};
const noPauses = { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false };
const base = (ws: string, components: Record<string, boolean> = {}) =>
  defaultRunConfig({ task: "Say hello", title: "Say hello", workspace: ws, components: { planner: false, osSandbox: false, actionClassifier: false, ...components } as any, pauses: noPauses, maxFixRounds: 0 });

const contractCalls: Scripted[] = [call("c1", "propose_contract", { criteria, rationale: "r" }), call("c2", "review_contract", { accept: true, criteria, feedback: "fine" })];
const writeSuite = toolUse("t1", "write_file", { path: "tests/hello.test.sh", content: suite + "\n" });
const build: Scripted[] = [
  { content: [toolUse("b1", "write_file", { path: "hello.txt", content: "hello\n" }), toolUse("b2", "edit_file", { path: "README.md", old_text: "# Sample", new_text: "# Sample\n\nSays hello." })], stop_reason: "tool_use" },
  call("b3", "finish", { summary: "built", open_items: [] }),
];

describe("the tests stage", () => {
  it("runs contract -> tests -> build -> evaluate: red suite recorded, tests.md written, T added to the contract, builder and evaluator briefed", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws);
    const seen: Record<string, string> = {};
    const { client, calls } = fakeClient([
      ...contractCalls,
      (params) => {
        const names = params.tools.map((t: any) => t.name);
        expect(names).toEqual(expect.arrayContaining(["propose_tests", "write_file", "edit_file", "bash", "read_file"]));
        expect(names).not.toContain("finish");
        seen.tests = lastUserText(params);
        return { content: [writeSuite, toolUse("t2", "bash", { command: "sh tests/hello.test.sh" })], stop_reason: "tool_use" } as any;
      },
      (params) => {
        // the writer saw its own suite fail
        expect(lastUserText(params)).toContain("FAIL hello.test.sh");
        return call("t3", "propose_tests", plan) as any;
      },
      (params) => ((seen.build = lastUserText(params)), build[0] as any),
      build[1],
      (params) => {
        seen.evaluate = lastUserText(params);
        return call("e1", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "grep ok" }, { id: "C2", pass: true, evidence: "grep ok" }, { id: "T", pass: true, evidence: "2 passed" }], summary: "all pass" }) as any;
      },
    ]);
    const bus = new RunBus("t-tests", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(7);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["contract", "tests", "build", "evaluate", "wrapup"]);

    // The writer's brief: the contract and what a good test is.
    expect(seen.tests).toContain("# Contract");
    expect(seen.tests).toContain("C1: hello.txt contains hello");
    expect(seen.tests).toMatch(/fail before any code is written/i);

    // The suite was run by the harness and was red.
    const agreed = events.find((e): e is Extract<RunEvent, { type: "tests.agreed" }> => e.type === "tests.agreed")!;
    expect(agreed.plan.command).toBe("sh tests/hello.test.sh");
    expect(agreed.plan.tests.map((t) => t.id)).toEqual(["T1", "T2"]);
    expect(agreed.red.exitCode).toBe(1);
    expect(agreed.red.excerpt).toContain("FAIL hello.test.sh");
    const md = fs.readFileSync(path.join(ws, ".reins/tests.md"), "utf8");
    expect(md).toContain("Two behaviour checks in one script");
    expect(md).toContain("## T1");
    expect(md).toContain("exit 1");
    expect(JSON.parse(fs.readFileSync(path.join(ws, ".reins/tests.json"), "utf8")).tests).toHaveLength(2);

    // T joins the contract: on disk, in a second contract.agreed, and in the evaluator's brief.
    const contract = JSON.parse(fs.readFileSync(path.join(ws, ".reins/contract.json"), "utf8"));
    expect(contract.map((c: any) => c.id)).toEqual(["C1", "C2", "T"]);
    expect(contract[2]).toEqual({ id: "T", text: "The tests written in the tests stage pass (sh tests/hello.test.sh)", verify: "sh tests/hello.test.sh", hard: true });
    const agreedContracts = events.filter((e): e is Extract<RunEvent, { type: "contract.agreed" }> => e.type === "contract.agreed");
    expect(agreedContracts.map((e) => e.criteria.length)).toEqual([2, 3]);
    expect(seen.evaluate).toContain("T: The tests written in the tests stage pass");

    // The builder is told what to make pass and not to touch the tests.
    expect(seen.build).toContain("# Tests to make pass");
    expect(seen.build).toContain("Run: sh tests/hello.test.sh");
    expect(seen.build).toContain("- T1 (behavior, tests/hello.test.sh) hello.txt says hello [C1]");
    expect(seen.build).toMatch(/Do not modify, weaken, skip or delete these tests/);

    // The tests are committed on their own, before the build commit.
    const log = execSync("git log --format=%s", { cwd: ws, encoding: "utf8" }).trim().split("\n");
    expect(log.slice(0, 2)).toEqual(["reins: build — Say hello", "reins: tests — Say hello"]);
    expect(execSync("sh tests/hello.test.sh", { cwd: ws, encoding: "utf8" })).toContain("2 passed");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("refuses a suite that already passes, a plan that leaves a hard criterion uncovered, and a missing file, then accepts", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws);
    const feedback: string[] = [];
    const { client, calls } = fakeClient([
      ...contractCalls,
      { content: [writeSuite, toolUse("t0", "write_file", { path: "tests/green.sh", content: "exit 0\n" })], stop_reason: "tool_use" },
      // 1: green before the build
      call("t1", "propose_tests", { ...plan, command: "sh tests/green.sh" }),
      // 2: C2 not covered
      (params) => (feedback.push(lastUserText(params)), call("t2", "propose_tests", { ...plan, tests: [plan.tests[0]] }) as any),
      // 3: file does not exist
      (params) => (feedback.push(lastUserText(params)), call("t3", "propose_tests", { ...plan, tests: [{ ...plan.tests[0], file: "tests/nope.sh" }, plan.tests[1]] }) as any),
      // 4: fine
      (params) => (feedback.push(lastUserText(params)), call("t4", "propose_tests", plan) as any),
      ...build,
      call("e1", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "ok" }, { id: "C2", pass: true, evidence: "ok" }, { id: "T", pass: true, evidence: "ok" }], summary: "all pass" }),
    ]);
    const bus = new RunBus("t-refuse-tests", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(10);
    expect(feedback[0]).toMatch(/Refused.*passes before any code is written/);
    expect(feedback[1]).toMatch(/Refused.*C2 .*not covered by any test/);
    expect(feedback[2]).toMatch(/Refused.*tests\/nope\.sh does not exist/);
    const results = events.filter((e): e is Extract<RunEvent, { type: "tool.result" }> => e.type === "tool.result" && e.name === "propose_tests");
    expect(results.map((x) => x.ok)).toEqual([false, false, false, true]);
    expect(events.filter((e) => e.type === "tests.agreed")).toHaveLength(1);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("with tests first switched off (an ablation) there is no tests phase and the contract is unchanged", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws, { testsFirst: false });
    const { client } = fakeClient([...contractCalls, ...build, call("e1", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "ok" }, { id: "C2", pass: true, evidence: "ok" }], summary: "pass" })]);
    const bus = new RunBus("t-notests", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["contract", "build", "evaluate", "wrapup"]);
    expect(JSON.parse(fs.readFileSync(path.join(ws, ".reins/contract.json"), "utf8")).map((c: any) => c.id)).toEqual(["C1", "C2"]);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("a writer that never proposes gets a warning and the build goes ahead without a tests criterion", async () => {
    const ws = tmpWorkspace();
    const cfg = { ...base(ws), maxTurnsPerPhase: 5 };
    const { client } = fakeClient([
      ...contractCalls,
      ...[1, 2, 3, 4, 5].map((i) => call(`t${i}`, "bash", { command: "echo looking" })),
      // the forced final call still does not propose
      { content: [text("I could not decide on a command.")], stop_reason: "end_turn" },
      ...build,
      call("e1", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "ok" }, { id: "C2", pass: true, evidence: "ok" }], summary: "pass" }),
    ]);
    const bus = new RunBus("t-noplan", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["contract", "tests", "build", "evaluate", "wrapup"]);
    expect(events.some((e) => e.type === "note" && e.level === "warn" && /did not call propose_tests.*without tests to make pass/i.test(e.text))).toBe(true);
    expect(events.filter((e) => e.type === "tests.agreed")).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(path.join(ws, ".reins/contract.json"), "utf8")).map((c: any) => c.id)).toEqual(["C1", "C2"]);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
