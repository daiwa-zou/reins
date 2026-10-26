import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Orchestrator } from "./orchestrator.js";
import { RunBus } from "./bus.js";
import { defaultRunConfig } from "../../../shared/components.js";
import type { RunEvent } from "../../../shared/types.js";
import { call, collect, control, fakeClient, lastUserText, phasesOf, tmpWorkspace, toolUse, type Scripted } from "./scripted.js";

// The breakdown stage: after the plan, the planner slices the feature list into
// work packages (one reviewable pull request each); contract, build and
// evaluate then run once per package, in order.

const features = [
  { id: "F1", title: "GET /health route", status: "todo" },
  { id: "F2", title: "Health test", status: "todo" },
  { id: "F3", title: "README section", status: "todo" },
];
const packages = [
  { id: "P1", title: "Health endpoint with its test", features: ["F1", "F2"], rationale: "One change a reviewer reads in one sitting.", estimated_lines: 120, depends_on: [] },
  { id: "P2", title: "Document the endpoint", features: ["F3"], rationale: "Docs follow the behaviour.", estimated_lines: 30, depends_on: ["P1"] },
];
const criteria = (id: string) => [{ id, text: `${id} holds`, verify: "cat README.md", hard: true }];

const noPauses = { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false };
const base = (ws: string, extra: Record<string, unknown> = {}) =>
  defaultRunConfig({ task: "Add a health endpoint", title: "Add a health endpoint", workspace: ws, components: { osSandbox: false, actionClassifier: false, ...((extra.components as object) ?? {}) } as any, pauses: noPauses, ...extra, maxFixRounds: 0 });

/** The planner's two turns: spec + features, then finish. */
const planner: Scripted[] = [
  { content: [toolUse("p1", "write_file", { path: ".reins/spec.md", content: "# spec" }), toolUse("p2", "update_progress", { features, note: "planned" })], stop_reason: "tool_use" },
  call("p3", "finish", { summary: "planned", open_items: [] }),
];
/** One package's contract, build and passing evaluation. */
const packageRound = (id: string, done: string[]): Scripted[] => [
  call(`${id}c1`, "propose_contract", { criteria: criteria(`C${id}`), rationale: "r" }),
  call(`${id}c2`, "review_contract", { accept: true, criteria: criteria(`C${id}`), feedback: "fine" }),
  { content: [toolUse(`${id}b1`, "write_file", { path: `${id}.txt`, content: id }), toolUse(`${id}b2`, "update_progress", { features: features.filter((f) => done.includes(f.id)).map((f) => ({ ...f, status: "done" })), note: `${id} built` })], stop_reason: "tool_use" },
  call(`${id}b3`, "finish", { summary: `${id} built`, open_items: [] }),
  call(`${id}e1`, "report_evaluation", { results: [{ id: `C${id}`, pass: true, evidence: "seen" }], summary: `${id} passes` }),
];

describe("the breakdown stage", () => {
  it("runs plan -> breakdown, then contract -> build -> evaluate once per package, then wrap up", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws, { pauses: { ...noPauses, afterPlan: true } });
    const seen: Record<string, string> = {};
    const { client, calls } = fakeClient([
      ...planner,
      (params) => {
        expect(params.tools.map((t: any) => t.name)).toContain("propose_breakdown");
        expect(params.tools.map((t: any) => t.name)).not.toContain("write_file");
        seen.breakdown = lastUserText(params);
        return call("bd", "propose_breakdown", { packages, rationale: "Two small pull requests." }) as any;
      },
      // P1
      (params) => ((seen.contractP1 = lastUserText(params)), call("P1c1", "propose_contract", { criteria: criteria("CP1"), rationale: "r" }) as any),
      ...packageRound("P1", ["F1", "F2"]).slice(1),
      // P2: the builder starts a fresh conversation for the new package
      (params) => ((seen.contractP2 = lastUserText(params)), call("P2c1", "propose_contract", { criteria: criteria("CP2"), rationale: "r" }) as any),
      packageRound("P2", ["F3"])[1],
      (params) => {
        expect(params.messages).toHaveLength(1);
        seen.buildP2 = lastUserText(params);
        return packageRound("P2", ["F3"])[2] as any;
      },
      ...packageRound("P2", ["F3"]).slice(3),
    ]);
    const bus = new RunBus("t-breakdown", false);
    const events = collect(bus);
    const approvals: any[] = [];
    const orch = new Orchestrator(client, cfg, bus, control({ requestPhaseApproval: async (title, _d, payload) => (approvals.push({ title, payload, at: phasesOf(events).map((p) => p.phase) }), { approved: true }) }));
    const r = await orch.run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(13);

    const phases = phasesOf(events);
    expect(phases.map((p) => p.phase)).toEqual(["plan", "breakdown", "contract", "build", "evaluate", "contract", "build", "evaluate", "wrapup"]);
    // Per-package phases say which package they belong to; plan, breakdown and wrap-up do not.
    expect(phases.map((p) => p.package?.id)).toEqual([undefined, undefined, "P1", "P1", "P1", "P2", "P2", "P2", undefined]);
    expect(phases[2].package).toEqual({ id: "P1", title: "Health endpoint with its test", index: 1, total: 2 });
    expect(events.filter((e): e is Extract<RunEvent, { type: "phase.finished" }> => e.type === "phase.finished" && e.phase === "build").map((e) => e.package?.id)).toEqual(["P1", "P2"]);

    // The breakdown is recorded as an event and a handoff file.
    const agreed = events.find((e): e is Extract<RunEvent, { type: "breakdown.agreed" }> => e.type === "breakdown.agreed")!;
    expect(agreed.packages.map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(agreed.rationale).toBe("Two small pull requests.");
    expect(JSON.parse(fs.readFileSync(path.join(ws, ".reins/packages.json"), "utf8")).map((p: any) => p.features)).toEqual([["F1", "F2"], ["F3"]]);

    // The planner's breakdown brief carries the feature list and the size cap.
    expect(seen.breakdown).toContain("F1: GET /health route");
    expect(seen.breakdown).toContain("400");
    // Each package's contract and build briefs name the package and only its features.
    expect(seen.contractP1).toContain("# Work package");
    expect(seen.contractP1).toContain("P1 of 2: Health endpoint with its test");
    expect(seen.contractP1).toContain("F2: Health test");
    expect(seen.contractP1).not.toContain("F3: README section");
    expect(seen.contractP2).toContain("P2 of 2: Document the endpoint");
    expect(seen.buildP2).toContain("P2 of 2: Document the endpoint");
    expect(seen.buildP2).toContain("Build only the features of this package");

    // The plan pause comes after the breakdown and shows the packages.
    expect(approvals).toHaveLength(1);
    expect(approvals[0].at).toEqual(["plan", "breakdown"]);
    expect(approvals[0].payload.packages.map((p: any) => p.id)).toEqual(["P1", "P2"]);
    expect(approvals[0].payload.spec).toBe("# spec");

    // One commit per package build, named after the package.
    const log = execSync("git log --format=%s", { cwd: ws, encoding: "utf8" });
    expect(log).toContain("reins: build P1 — Health endpoint with its test");
    expect(log).toContain("reins: build P2 — Document the endpoint");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("refuses an invalid breakdown with the reasons, and the planner proposes again", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws);
    let feedback = "";
    const { client, calls } = fakeClient([
      ...planner,
      call("bd1", "propose_breakdown", { packages: [{ id: "P1", title: "Everything", features: ["F1", "F2"], rationale: "r", estimated_lines: 900, depends_on: [] }], rationale: "one" }),
      (params) => {
        feedback = lastUserText(params);
        return call("bd2", "propose_breakdown", { packages, rationale: "Two small pull requests." }) as any;
      },
      ...packageRound("P1", ["F1", "F2"]),
      ...packageRound("P2", ["F3"]),
    ]);
    const bus = new RunBus("t-refuse", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(14);
    expect(feedback).toMatch(/Refused/);
    expect(feedback).toMatch(/F3.*no package/);
    expect(feedback).toMatch(/P1 estimates 900 changed lines/);
    const results = events.filter((e): e is Extract<RunEvent, { type: "tool.result" }> => e.type === "tool.result" && e.name === "propose_breakdown");
    expect(results.map((x) => x.ok)).toEqual([false, true]);
    expect(events.filter((e) => e.type === "breakdown.agreed")).toHaveLength(1);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("without the planner there is no breakdown: one contract, one build, no package on the phases", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws, { components: { planner: false } });
    const { client } = fakeClient([...packageRound("P1", ["F1", "F2", "F3"])]);
    const bus = new RunBus("t-noplanner", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    const phases = phasesOf(events);
    expect(phases.map((p) => p.phase)).toEqual(["contract", "build", "evaluate", "wrapup"]);
    expect(phases.every((p) => p.package === undefined)).toBe(true);
    expect(fs.existsSync(path.join(ws, ".reins/packages.json"))).toBe(false);
    expect(execSync("git log --format=%s", { cwd: ws, encoding: "utf8" })).toContain("reins: build — Add a health endpoint");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("with work packages switched off (an ablation) the plan is built as one package", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws, { components: { workPackages: false } });
    const { client } = fakeClient([...planner, ...packageRound("P1", ["F1", "F2", "F3"])]);
    const bus = new RunBus("t-ablated", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["plan", "contract", "build", "evaluate", "wrapup"]);
    expect(phasesOf(events).every((p) => p.package === undefined)).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("a planner that records no features gets no breakdown stage, with a warning", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws);
    const { client } = fakeClient([
      { content: [toolUse("p1", "write_file", { path: ".reins/spec.md", content: "# spec" })], stop_reason: "tool_use" },
      call("p3", "finish", { summary: "planned", open_items: [] }),
      ...packageRound("P1", []),
    ]);
    const bus = new RunBus("t-nofeatures", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(true);
    expect(phasesOf(events).map((p) => p.phase)).toEqual(["plan", "contract", "build", "evaluate", "wrapup"]);
    expect(events.some((e) => e.type === "note" && e.level === "warn" && /recorded no features.*breakdown/i.test(e.text))).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("a package that fails evaluation stops the run before the next package starts, naming the package", async () => {
    const ws = tmpWorkspace();
    const cfg = base(ws);
    const { client, calls } = fakeClient([
      ...planner,
      call("bd", "propose_breakdown", { packages, rationale: "two" }),
      ...packageRound("P1", ["F1", "F2"]).slice(0, 4),
      call("P1e1", "report_evaluation", { results: [{ id: "CP1", pass: false, evidence: "nope" }], summary: "P1 fails" }),
    ]);
    const bus = new RunBus("t-fail", false);
    const events = collect(bus);
    const r = await new Orchestrator(client, cfg, bus, control()).run();
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(8);
    expect(r.summary).toMatch(/^Package P1 \(Health endpoint with its test\): Evaluation still failing after 0 fix rounds: P1 fails/);
    expect(phasesOf(events).filter((p) => p.package?.id === "P2")).toHaveLength(0);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
