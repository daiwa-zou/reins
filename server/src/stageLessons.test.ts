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
  it("derives every component's lessons from the bundled implications", () => {
    const { components, foundations } = linkCatalogue(listLessons());
    for (const c of components) expect(c.lessons.length, c.id).toBeGreaterThan(0);
    for (const f of foundations) expect(f.lessons.length, f.id).toBeGreaterThan(0);
    expect(components.find((c) => c.id === "evaluator")!.lessons).toEqual(expect.arrayContaining(["harness-design-long-running-apps", "demystifying-evals-for-ai-agents"]));
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
  it("layers domains over one profile and labels the run", () => {
    const c = composeRun(["careful", "golang", "cli"], listLessons());
    expect(c.presets).toEqual(["careful", "golang", "cli"]);
    expect(c.label).toBe("Careful · Go · CLI");
    expect(presetsLabel(["full", "web"])).toBe("Full · Web");
    expect(c.config.pauses).toMatchObject({ afterPlan: true, beforeCommit: true });
    expect(c.config.guardrail?.mode).toBe("ask");
    expect(c.config.guidance!.some((g) => g.includes("go vet"))).toBe(true);
    expect(() => composeRun(["careful", "minimal"], [])).toThrow(/exactly one/);
    expect(() => composeRun(["careful", "nonsense"], [])).toThrow(/unknown preset/);
    expect(() => composeRun(["golang"], [])).toThrow(/exactly one/);
  });
  it("later domains win component switches and the override is recorded", () => {
    const a = lesson("a", "2025-01-01", [], { domains: ["x"], enables: ["actionClassifier"] });
    const c = composeRun(["careful", "x"], [a]);
    expect(c.config.components!.actionClassifier).toBe(true);
    expect(c.basis[0].effect).toMatch(/overrides Careful/);
    const b = lesson("b", "2025-02-01", [], { domains: ["y"], disables: ["actionClassifier"] });
    const c2 = composeRun(["careful", "x", "y"], [a, b]);
    expect(c2.config.components!.actionClassifier).toBe(false);
    expect(c2.basis.find((x) => x.slug === "b")!.effect).toMatch(/overrides a/);
  });
  it("the profile owns the engine", () => {
    const d = lesson("d", "2025-01-01", [], { domains: ["z"] });
    expect(composeRun(["full", "z"], [d]).config.engine).toBeUndefined();
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
    expect(cfg.presets).toEqual(["careful", "golang", "cli"]);
    expect(cfg.preset).toBe("Careful · Go · CLI");
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
