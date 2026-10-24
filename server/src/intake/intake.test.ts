import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { RunEvent } from "../../../shared/types.js";
import { quoteInSource } from "../../../shared/lessons.js";
import { IntakeManager, IntakeRefused, type DraftLesson } from "./intake.js";
import { getLesson, invalidateLessons } from "../lessons.js";

const ARTICLE = `# Verifying agent work with fresh eyes

Teams that ran long agent sessions found that the agent grading its own work approved 40% more broken builds than a separate reviewer did.
A reviewer that starts from a clean context and sees only the diff and the acceptance criteria catches the regressions the author talked itself past.
We now require every build stage to end by running the project's own test command and pasting the output.
Nobody has built a way to replay a failed session against a newer model yet.
`;

function fakeClient(script: any[]) {
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
const propose = (id: string, draft: Partial<DraftLesson>) => ({ content: [{ type: "tool_use", id, name: "propose_lesson", input: draft }], stop_reason: "tool_use" });

const good: DraftLesson = {
  slug: "fresh-eyes-review",
  title: "Verifying agent work with fresh eyes",
  date: "2026-10-01",
  url: "",
  source: "article",
  takeaway: "A separate reviewer with a clean context catches what a self-grading agent approves.",
  tags: ["evals"],
  learnings: ["Self-grading approved 40% more broken builds than a separate reviewer."],
  implications: [
    { kind: "component", target: "evaluator", claim: "Keep the evaluator separate from the builder.", quote: "the agent grading its own work approved 40% more broken builds than a separate reviewer did", domains: [] },
    { kind: "stage", target: "evaluate", claim: "Review only the diff and the criteria, from a clean context.", quote: "A reviewer that starts from a clean context and sees only the diff and the acceptance criteria", domains: [] },
    { kind: "stage", target: "build", claim: "End the build by running the project's test command and pasting the output.", quote: "end by running the project's own test command and pasting the output", domains: [] },
    { kind: "gap", target: "", claim: "Replay a failed session against a newer model.", quote: "Nobody has built a way to replay a failed session against a newer model yet.", domains: [] },
  ],
};

describe("lesson intake job", () => {
  let home: string;
  const prev = process.env.REINS_HOME;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "reins-intake-"));
    process.env.REINS_HOME = home;
    invalidateLessons();
  });
  afterAll(() => {
    process.env.REINS_HOME = prev;
    invalidateLessons();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("distils pasted text, rejects a made-up quote, waits for approval, and adopts into $REINS_HOME/lessons", async () => {
    const bad = { ...good, implications: [...good.implications, { kind: "stage" as const, target: "build", claim: "Invented.", quote: "this sentence is not in the article", domains: [] }] };
    const { client, calls } = fakeClient([propose("t1", bad), propose("t2", good)]);
    const mgr = new IntakeManager({ client: () => client, hasClaudeCode: () => false });
    const events: RunEvent[] = [];
    mgr.on("event", (e: RunEvent) => events.push(e));
    const { id, slug } = mgr.start({ text: ARTICLE });
    expect(id).toBe(`intake-${slug}`);
    const dir = path.join(home, "lessons", slug);
    expect(fs.readFileSync(path.join(dir, "source.md"), "utf8")).toBe(ARTICLE);

    // Waits for approval with a draft whose every quote is verbatim in the source.
    for (let i = 0; i < 200 && !mgr.pendingApprovals(id).length; i++) await new Promise((r) => setTimeout(r, 10));
    const [req] = mgr.pendingApprovals(id);
    expect(req.kind).toBe("lesson");
    const draft = req.payload as DraftLesson;
    for (const i of draft.implications) expect(quoteInSource(i.quote, ARTICLE), i.quote).toBe(true);
    expect(fs.readFileSync(path.join(dir, "draft.md"), "utf8")).toContain("[stage:evaluate]");
    // The made-up quote came back to the librarian as a tool error.
    expect(JSON.stringify(calls[1].messages)).toContain("not found verbatim");
    expect(fs.existsSync(path.join(home, "lessons", "fresh-eyes-review.md"))).toBe(false);
    expect(mgr.list()[0]).toMatchObject({ id, status: "waiting_approval" });

    // The user drops the gap and marks the lesson reviewed.
    mgr.approve(id, req.approvalId, "approve", undefined, { implications: draft.implications.filter((i) => i.kind !== "gap"), standing: "reviewed" });
    await mgr.settled(id);
    const file = path.join(home, "lessons", "fresh-eyes-review.md");
    expect(fs.existsSync(file)).toBe(true);
    invalidateLessons();
    const l = getLesson("fresh-eyes-review")!;
    expect(l).toMatchObject({ source: "user", standing: "reviewed", provenance: "article" });
    expect(l.items.map((i) => i.kind)).toEqual(["component", "stage", "stage"]);
    expect(l.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(events.some((e) => e.type === "run.status" && e.status === "completed")).toBe(true);
    expect(fs.readFileSync(path.join(dir, "events.jsonl"), "utf8")).toContain("approval.requested");
    // Never in the runs directory.
    expect(fs.existsSync(path.join(home, "runs", id, "config.json"))).toBe(false);
    const runsDir = path.join(home, "runs");
    expect(fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []).toEqual([]);
    // The dropped implication is not in the adopted file.
    const dropped = draft.implications.find((i) => i.kind === "gap")!;
    expect(dropped).toBeTruthy();
    expect(fs.readFileSync(file, "utf8")).not.toContain(dropped.claim);
    expect(fs.readFileSync(file, "utf8")).toMatch(/^standing: reviewed$/m);

    // The same source again is refused by its content hash.
    expect(() => mgr.start({ text: ARTICLE.replace(/\n/g, "\n\n") })).toThrow(IntakeRefused);
    // The refusal names the existing lesson and creates no new job.
    const jobsBefore = mgr.list().length;
    expect(() => mgr.start({ text: ARTICLE })).toThrow(new RegExp(draft.slug));
    expect(mgr.list().length).toBe(jobsBefore);
  });
});
