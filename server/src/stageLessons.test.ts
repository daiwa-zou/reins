import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Implication, Lesson } from "../../shared/types.js";
import { defaultRunConfig } from "../../shared/components.js";
import { parseLesson } from "../../shared/lessons.js";
import { ideas, linkCatalogue, renderStageBlock, stageImplications, STAGE_BLOCK_CAP } from "../../shared/implications.js";
import { composeRun, presetsLabel } from "../../shared/presets.js";
import { listLessons } from "./lessons.js";
import { seededHome } from "./testLibrary.js";

// These tests read real lessons; lessons/ ships empty, so they run against the example library.
process.env.REINS_HOME = seededHome("reins-stage-home-");
import { resolveRunInput } from "./presets.js";
import { firstMessage } from "./roles/prompts.js";
import { Orchestrator } from "./engine/orchestrator.js";
import { RunBus } from "./engine/bus.js";

const impl = (lesson: string, date: string, claim: string, extra: Partial<Implication> = {}): Implication => ({ id: `${lesson}#${claim}`, lesson, date, kind: "stage", target: "build", claim, quote: "q", domains: [], standing: "bundled", ...extra });
const lesson = (slug: string, date: string, items: Implication[], extra: Partial<Lesson> = {}): Lesson => ({ slug, title: slug, date, url: "", takeaway: "t", learnings: ["l"], implications: items.map((i) => i.claim), components: [], foundations: [], tags: [], source: "bundled", items, standing: "bundled", ...extra });

describe("typed implications", () => {
  const raw = (impls: string) => `---\ntitle: T\ndate: 2026-01-01\ntakeaway: x.\n---\n## Learnings\n- The quote lives here.\n## Harness implications\n${impls}\n`;
  it("parses kind, target, claim, quote and domains, with lesson domains merged", () => {
    const { lesson: l, problems } = parseLesson("t", raw("- [stage:evaluate] Check the live app.\n  domains: web\n  > The quote lives here.").replace("takeaway:", "domains: cli\ntakeaway:"));
    expect(problems).toEqual([]);
    expect(l!.items[0]).toMatchObject({ kind: "stage", target: "evaluate", claim: "Check the live app.", quote: "The quote lives here.", domains: ["web", "cli"], standing: "bundled" });
  });
  it("keeps untyped bullets as gaps with a warning", () => {
    const { lesson: l, problems } = parseLesson("t", raw("- Just an idea."));
    expect(l!.items[0]).toMatchObject({ kind: "gap", claim: "Just an idea." });
    expect(problems.filter((p) => p.level === "warn").length).toBe(1);
    expect(problems.filter((p) => p.level === "error")).toEqual([]);
  });
  it("rejects an unknown target id for every kind", () => {
    for (const b of ["[component:notAThing] x", "[stage:deploy] x", "[foundation:nope] x", "[skill:no-such-skill] x", "[weird:build] x"]) {
      const errs = parseLesson("t", raw(`- ${b}\n  > The quote lives here.`), "bundled", { skills: ["verify-like-a-user"] }).problems.filter((p) => p.level === "error");
      expect(errs.length, b).toBeGreaterThan(0);
    }
  });
  it("user lessons default to unreviewed and never enter stage blocks", () => {
    const l = parseLesson("u", raw("- [stage:build] Untrusted line.\n  > The quote lives here."), "user").lesson!;
    expect(l.standing).toBe("unreviewed");
    expect(stageImplications([l], "build")).toEqual([]);
    expect(ideas([l]).map((i) => i.claim)).toEqual(["Untrusted line."]);
  });
});

describe("one table, three views", () => {
  it("derives a component's lessons from the implications that target it, and tolerates a component none targets", () => {
    const { components } = linkCatalogue(listLessons());
    expect(components.find((c) => c.id === "evaluator")!.lessons).toEqual(expect.arrayContaining(["harness-design-long-running-apps", "demystifying-evals-for-ai-agents"]));
    expect(linkCatalogue([]).components.map((c) => c.lessons)).toEqual(components.map(() => []));
  });
  it("orders reviewed before bundled, newest first, deduplicates and caps at 8", () => {
    const lessons = [
      lesson("old", "2024-01-01", [impl("old", "2024-01-01", "Old line."), impl("old", "2024-01-01", "Shared line.")]),
      lesson("new", "2026-01-01", [impl("new", "2026-01-01", "New line."), impl("new", "2026-01-01", "shared line")]),
      lesson("rev", "2020-01-01", [impl("rev", "2020-01-01", "Reviewed line.", { standing: "reviewed" })], { source: "user", standing: "reviewed" }),
      lesson("many", "2025-01-01", Array.from({ length: 12 }, (_, n) => impl("many", "2025-01-01", `Many ${n}.`))),
    ];
    const got = stageImplications(lessons, "build").map((i) => i.claim);
    expect(got[0]).toBe("Reviewed line.");
    expect(got[1]).toBe("New line.");
    expect(got.length).toBe(STAGE_BLOCK_CAP);
    expect(new Set(got.map((g) => g.toLowerCase().replace(/\.$/, ""))).size).toBe(got.length);
  });
});

describe("composable presets", () => {
  it("layers domains over the effort and supervision dials and labels the run", () => {
    const c = composeRun({ effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] }, listLessons());
    expect(c.domains).toEqual(["golang", "cli"]);
    expect(c.label).toBe("High · Ask every write · Go · CLI");
    expect(presetsLabel(["full", "web"])).toBe("Full · Web");
    expect(c.config.pauses).toMatchObject({ afterPlan: true, beforeCommit: true });
    expect(c.config.guardrail?.mode).toBe("ask");
    expect(c.config.guidance!.some((g) => g.includes("go vet"))).toBe(true);
    expect(() => composeRun({ effort: "extreme" as any }, [])).toThrow(/unknown effort/);
    expect(() => composeRun({ effort: "high", domains: ["nonsense"] }, [])).toThrow(/unknown domain/);
    expect(() => composeRun({ supervision: "sometimes" as any, domains: ["golang"] }, [])).toThrow(/unknown supervision/);
  });
  it("later domains win component switches and the override is recorded", () => {
    const a = lesson("a", "2025-01-01", [], { domains: ["x"], enables: ["thinkTool"] });
    const c = composeRun({ effort: "high", supervision: "ask-every-write", domains: ["x"] }, [a]);
    expect(c.config.components!.thinkTool).toBe(true);
    expect(c.basis[0].effect).toMatch(/overrides High effort/);
    const b = lesson("b", "2025-02-01", [], { domains: ["y"], disables: ["thinkTool"] });
    const c2 = composeRun({ effort: "high", supervision: "ask-every-write", domains: ["x", "y"] }, [a, b]);
    expect(c2.config.components!.thinkTool).toBe(false);
    expect(c2.basis.find((x) => x.slug === "b")!.effect).toMatch(/overrides a/);
  });
  it("no domain owns the engine", () => {
    const d = lesson("d", "2025-01-01", [], { domains: ["z"] });
    expect(composeRun({ domains: ["z"] }, [d]).config.engine).toBeUndefined();
  });
});

type Scripted = Partial<Anthropic.Beta.BetaMessage>;
function fakeClient(script: Scripted[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: any) => {
          calls.push(structuredClone(params));
          const body = script.shift();
          if (!body) throw new Error("script exhausted");
          const msg = { id: "m", type: "message", role: "assistant", model: params.model, content: [], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...body };
          return { finalMessage: async () => msg };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}
const toolUse = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input }) as any;

describe("a run with presets careful, golang, cli", () => {
  it("records the presets and the build phase's first message carries the merged stage block (no duplicates, at most 8)", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "reins-stage-"));
    const cfg = defaultRunConfig({ ...resolveRunInput({ task: "Add a --version flag", workspace: ws, presets: ["careful", "golang", "cli"] }), id: "stage-test" });
    cfg.components.testsFirst = false; // this test is about the build brief, not the tests stage
    // The legacy body is migrated and recorded in the new shape.
    expect(cfg.presets).toBeUndefined();
    expect(cfg).toMatchObject({ effort: "high", supervision: "ask-every-write", domains: ["golang", "cli"] });
    expect(cfg.preset).toBe("High · Ask every write · Go · CLI");
    expect(cfg.components.stageLessons).toBe(true);
    const criteria = [{ id: "C1", text: "x", verify: "y", hard: true }];
    const { client, calls } = fakeClient([
      { content: [toolUse("p", "finish", { summary: "planned", open_items: [] })], stop_reason: "tool_use" },
      { content: [toolUse("c1", "propose_contract", { criteria, rationale: "r" })], stop_reason: "tool_use" },
      { content: [toolUse("c2", "review_contract", { accept: true, criteria, feedback: "ok" })], stop_reason: "tool_use" },
      { content: [toolUse("b", "finish", { summary: "built", open_items: [] })], stop_reason: "tool_use" },
      { content: [toolUse("e", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "ok" }], summary: "ok" })], stop_reason: "tool_use" },
    ]);
    const orch = new Orchestrator(client, cfg, new RunBus("stage-test", false), {
      signal: new AbortController().signal,
      waitIfPaused: async () => {},
      requestApproval: async () => ({ approved: true }),
      drainSteer: () => [],
      remainingBudget: () => 100,
      requestPhaseApproval: async () => ({ approved: true }),
      requestContractApproval: async () => ({ approved: true }),
    });
    const r = await orch.run();
    expect(r.ok).toBe(true);
    const build = calls.find((c) => String(c.messages[0].content).includes("# Phase\nbuild"))!;
    const first = String(build.messages[0].content);
    const block = first.split("# Lessons for this stage\n")[1].split("\n\n#")[0].split("\n");
    expect(block.length).toBeGreaterThan(0);
    expect(block.length).toBeLessThanOrEqual(8);
    expect(new Set(block).size).toBe(block.length);
    // cli-tagged lessons are in; web-only ones are not.
    expect(first).toContain("(writing-tools-for-agents)");
    expect(first).not.toContain("(harness-design-long-running-apps)");
    // The switch is honoured: off means no block.
    expect(firstMessage("build", { ...cfg, components: { ...cfg.components, stageLessons: false } })).not.toContain("Lessons for this stage");
    expect(renderStageBlock(["a", "a", "b"])).toBe("- a\n- b");
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("max effort re-runs every criterion", () => {
  const criteria = [
    { id: "C1", text: "x", verify: "y", hard: true },
    { id: "C2", text: "soft one", verify: "z", hard: false },
  ];
  const script = (extra: Scripted[]): Scripted[] => [
    { content: [toolUse("p", "finish", { summary: "planned", open_items: [] })], stop_reason: "tool_use" },
    { content: [toolUse("c1", "propose_contract", { criteria, rationale: "r" })], stop_reason: "tool_use" },
    { content: [toolUse("c2", "review_contract", { accept: true, criteria, feedback: "ok" })], stop_reason: "tool_use" },
    { content: [toolUse("b", "finish", { summary: "built", open_items: [] })], stop_reason: "tool_use" },
    { content: [toolUse("e1", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "ok" }], summary: "partial" })], stop_reason: "tool_use" },
    ...extra,
  ];
  const control = { signal: new AbortController().signal, waitIfPaused: async () => {}, requestApproval: async () => ({ approved: true }), drainSteer: () => [], remainingBudget: () => 100, requestPhaseApproval: async () => ({ approved: true }), requestContractApproval: async () => ({ approved: true }) };
  const make = (effort: "max" | "high") => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "reins-max-"));
    const cfg = defaultRunConfig({ ...resolveRunInput({ task: "t", workspace: ws, effort, supervision: "unattended" }), id: `max-${effort}` });
    cfg.components.testsFirst = false; // these tests are about the evaluator's report, not the tests stage
    return { ws, cfg };
  };
  it("at max, a report that omits a criterion is refused naming the missing id, and the prompt says to re-run every criterion", async () => {
    const { ws, cfg } = make("max");
    expect(cfg.effort).toBe("max");
    const { client, calls } = fakeClient(script([{ content: [toolUse("e2", "report_evaluation", { results: [{ id: "C1", pass: true, evidence: "ok" }, { id: "C2", pass: true, evidence: "ok" }], summary: "all" })], stop_reason: "tool_use" }]));
    const r = await new Orchestrator(client, cfg, new RunBus("max-max", false), control).run();
    expect(r.ok).toBe(true);
    const evalCalls = calls.filter((c) => String(c.messages[0].content).includes("# Phase\nevaluate"));
    expect(String(evalCalls[0].messages[0].content)).toContain("afresh");
    const retry = JSON.stringify(evalCalls[1].messages);
    expect(retry).toMatch(/Refused at max effort: the report omits criteria C2/);
    fs.rmSync(ws, { recursive: true, force: true });
  });
  it("at high, the same incomplete report is accepted as before", async () => {
    const { ws, cfg } = make("high");
    const { client, calls } = fakeClient(script([]));
    const r = await new Orchestrator(client, cfg, new RunBus("max-high", false), control).run();
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => String(c.messages[0].content).includes("# Phase\nevaluate"))).toHaveLength(1);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

