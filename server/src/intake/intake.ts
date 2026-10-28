// Lesson intake: a separate job type, not a run. It reuses the loop classes,
// RunBus and the approval flow, but has its own orchestrator and its own
// storage under $REINS_HOME/lessons/<slug>/ (source.md, draft.md,
// events.jsonl, job.json). Intake jobs never appear in the Runs list or in
// trial sets; their events still stream to the Stage like a run's.
//
//   fetch/read source -> librarian distils (propose_lesson) -> check() hook
//   -> approval card (edit/drop implications, set standing) -> adopt
//
// A source is a URL or pasted text (read whole, up front), or one the
// librarian explores with tools: a git repository (cloned or read in place)
// or an MCP server (its tools attached). Explored sources come with a focus,
// what to look for, and source.md becomes the record of what the librarian
// actually read, so quotes are still checked verbatim.
import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ApprovalDecision, ApprovalRequest, EngineId, ImplicationKind, IntakeSourceSpec, LessonProvenance, McpServerSpec, RunConfig, RunEvent, Standing, Usage } from "../../../shared/types.js";
import { COMPONENT_IDS, defaultRunConfig, EFFORT_TABLE, FOUNDATIONS } from "../../../shared/components.js";
import { IMPLICATION_KINDS, LESSON_SLUG, normalizeForQuote, parseLesson, PHASES, PROVENANCES, quoteInSource, renderImplication } from "../../../shared/lessons.js";
import { fileEventStore, RunBus } from "../engine/bus.js";
import { AgentLoop, type LoopControl, type LoopOptions } from "../engine/loop.js";
import { ClaudeCodeLoop } from "../engine/claudeCodeLoop.js";
import { readEventFile } from "../store/runStore.js";
import { listLessons, userLessonsDir, writeUserLesson } from "../lessons.js";
import { loadSkills } from "../skills.js";
import { librarianPrompt } from "../roles/prompts.js";
import { budgetOf } from "../../../shared/budget.js";
import { emptyUsage } from "../engine/pricing.js";
import { connectMcpSource, type McpSource } from "./mcpSource.js";
import { resolveMcpInput } from "./mcpConfig.js";

export const INTAKE_PREFIX = "intake-";
export const isIntakeId = (id: string) => typeof id === "string" && id.startsWith(INTAKE_PREFIX);
const MAX_SOURCE_CHARS = 200_000;

export interface DraftImplication {
  kind: ImplicationKind;
  target: string;
  claim: string;
  quote: string;
  domains: string[];
}

export interface DraftLesson {
  slug: string;
  title: string;
  date: string;
  url: string;
  source: LessonProvenance;
  takeaway: string;
  tags: string[];
  learnings: string[];
  implications: DraftImplication[];
}

/** What the approval card sends back: the implications to keep (edited), and the standing. */
export interface LessonEdits {
  implications?: DraftImplication[];
  standing?: Standing;
}

export interface IntakeJobFile {
  id: string;
  slug: string;
  /** The duplicate key: the page URL, the repository URL or path, or mcp://<name>. */
  url?: string;
  /** Absent for jobs from before explored sources: then url means a page, else pasted text. */
  source?: IntakeSourceSpec;
  /** What to look for (required for a repository or MCP server; a hint for a page or text). */
  focus?: string;
  hash?: string;
  status: "running" | "waiting_approval" | "adopted" | "rejected" | "failed" | "refused" | "cancelled" | "interrupted";
  createdAt: string;
  /** Last change (ISO). */
  updatedAt?: string;
  /** The adopted lesson's slug (status adopted). */
  lessonSlug?: string;
  lessonFile?: string;
  reason?: string;
}

/** What a refused source matches: a lesson already in the library, or an intake job still in progress. */
export interface IntakeDuplicate {
  kind: "lesson" | "job";
  slug: string;
  /** The intake job id (kind job), so the UI can open it. */
  jobId?: string;
  /** The job's status (kind job). */
  status?: IntakeJobFile["status"];
  sameUrl?: boolean;
}

/** The refusal message for a duplicate source. A pending job is not "in the library" yet, so it says where it is instead. */
export function duplicateMessage(d: IntakeDuplicate): string {
  if (d.kind === "lesson") return `This source matches ${d.slug}; it is already in the library.`;
  const where = d.status === "waiting_approval" ? "its draft is waiting for your approval" : "the librarian is still distilling it";
  return `This source is already being taken in by intake job ${d.slug} (${where}); open it from Lessons › Intake jobs, or cancel it there to start again.`;
}

export class IntakeRefused extends Error {
  constructor(message: string, public readonly duplicate?: IntakeDuplicate) {
    super(message);
  }
}

/** Content hash of a source: whitespace- and case-insensitive, so a re-paste of the same article matches. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(normalizeForQuote(text)).digest("hex");
}

export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/https?:\/\/[^/]+\//, "")
    .replace(/\.(html?|md|pdf)$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return out || `lesson-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

/** Crude HTML to text: drop scripts, styles and tags, decode the common entities. */
export function htmlToText(html: string): string {
  if (!/<[a-z!/][^>]*>/i.test(html)) return html;
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Render a draft (plus standing, hash and focus) to the lesson markdown format. */
export function renderLessonMarkdown(d: DraftLesson, extra: { standing: Standing; hash?: string; focus?: string }): string {
  const one = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
  const fm = [
    "---",
    `title: ${one(d.title)}`,
    `date: ${one(d.date)}`,
    ...(d.url ? [`url: ${one(d.url)}`] : []),
    `source: ${d.source}`,
    `standing: ${extra.standing}`,
    ...(extra.hash ? [`hash: ${extra.hash}`] : []),
    ...(extra.focus?.trim() ? [`focus: ${one(extra.focus)}`] : []),
    ...(d.tags.length ? [`tags: ${d.tags.map(one).join(", ")}`] : []),
    `takeaway: ${one(d.takeaway)}`,
    "---",
  ];
  return `${fm.join("\n")}\n\n## Learnings\n${d.learnings.map((l) => `- ${one(l)}`).join("\n")}\n\n## Harness implications\n${d.implications.map((i) => renderImplication({ ...i, target: i.kind === "gap" ? undefined : i.target })).join("\n")}\n`;
}

/** Every problem with a draft against its source; empty means it may be proposed. */
export function draftProblems(d: DraftLesson, sourceText: string): string[] {
  const out: string[] = [];
  if (!d || typeof d !== "object") return ["the draft is not an object"];
  if (!LESSON_SLUG.test(String(d.slug ?? ""))) out.push(`slug "${d.slug}" is not a valid file name (lowercase letters, digits and -)`);
  if (!PROVENANCES.includes(d.source)) out.push(`source must be one of ${PROVENANCES.join(", ")}`);
  if (!Array.isArray(d.implications) || !d.implications.length) out.push("add at least one implication");
  (d.implications ?? []).forEach((i, n) => {
    if (!i.quote?.trim()) out.push(`implication ${n + 1} has no quote`);
    else if (!quoteInSource(i.quote, sourceText)) out.push(`implication ${n + 1}: the quote is not found verbatim in source.md: "${i.quote.slice(0, 80)}"`);
  });
  const md = renderLessonMarkdown({ ...d, tags: d.tags ?? [], learnings: d.learnings ?? [], implications: d.implications ?? [] }, { standing: "unreviewed" });
  const parsed = parseLesson(String(d.slug || "draft"), md, "user", { skills: loadSkills(null).map((s) => s.name), sourceText });
  for (const p of parsed.problems) if (p.level === "error") out.push(p.message);
  return out;
}

interface Pending {
  request: ApprovalRequest;
  resolve: (r: { approved: boolean; note?: string; edits?: LessonEdits }) => void;
}

interface ActiveJob {
  config: RunConfig;
  bus: RunBus;
  abort: AbortController;
  pending: Map<string, Pending>;
  dir: string;
  /** After a restart: the lesson approval still open in the event log, asked again under the same id so the card on the Stage stays valid. */
  reopen?: ApprovalRequest;
}

export interface IntakeDeps {
  client: () => Anthropic | null;
  hasClaudeCode: () => boolean;
  /** Fetch a URL's text (injectable for tests). Defaults to global fetch. */
  fetchText?: (url: string, signal: AbortSignal) => Promise<{ status: number; text: string }>;
  /** Connect to an MCP server for the direct engine (injectable for tests). Defaults to a stdio or HTTP client. */
  mcpSource?: (spec: McpServerSpec) => Promise<McpSource>;
}

/** The source a job reads, from its file; old jobs recorded only a url. */
export function sourceOf(job: IntakeJobFile): IntakeSourceSpec {
  return job.source ?? (job.url ? { kind: "url", url: job.url } : { kind: "text" });
}

/** One line naming a source, for lists and notes. */
export function describeSource(src: IntakeSourceSpec): string {
  switch (src.kind) {
    case "url":
      return src.url;
    case "text":
      return "pasted text";
    case "repo":
      return `repository ${src.repo}${src.ref ? ` (${src.ref})` : ""}`;
    case "mcp":
      return `MCP server ${src.server.name}`;
  }
}

const explored = (src: IntakeSourceSpec) => src.kind === "repo" || src.kind === "mcp";
/** Tools whose output is the librarian's own words, so nothing in it may serve as a quote. */
const UNQUOTABLE = new Set(["think", "propose_lesson", "TodoWrite"]);

/** Shallow-clone a repository (one branch, no history) into dir; throws with git's output on failure. */
function cloneRepo(repo: string, ref: string | undefined, dir: string, signal: AbortSignal): Promise<void> {
  const args = ["clone", "--quiet", "--depth", "1", ...(ref ? ["--branch", ref] : []), "--", repo, dir];
  return new Promise((resolve, reject) => {
    execFile("git", args, { signal, timeout: 300_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 1 << 20 }, (err, _out, stderr) => {
      if (err) reject(new Error(`git clone failed: ${String(stderr || err.message).trim().slice(-500)}`));
      else resolve();
    });
  });
}

/** The first message's description of a repository: its top-level entries, so the librarian knows where to start. */
function repoOutline(ws: string): string {
  try {
    const names = fs.readdirSync(ws).filter((n) => n !== ".git").sort();
    return names.slice(0, 60).map((n) => (fs.statSync(path.join(ws, n)).isDirectory() ? `${n}/` : n)).join("\n") + (names.length > 60 ? `\n… ${names.length - 60} more` : "");
  } catch {
    return "(unreadable)";
  }
}

/**
 * One intake job. The librarian distils, then check() runs, then the user
 * approves. check() is the documented hook for a later checker role: it may
 * annotate or reject implications before the approval card is shown.
 */
export class IntakeOrchestrator {
  private draft: DraftLesson | null = null;
  constructor(
    private job: IntakeJobFile,
    private config: RunConfig,
    private bus: RunBus,
    private control: LoopControl & { requestLessonApproval: (draft: DraftLesson) => Promise<{ approved: boolean; note?: string; edits?: LessonEdits }> },
    private deps: IntakeDeps,
    private dir: string,
  ) {}

  private sourcePath = () => path.join(this.dir, "source.md");

  /** Hook for a later checker role. Version one passes the draft through unchanged. */
  protected async check(draft: DraftLesson, _sourceText: string): Promise<DraftLesson> {
    return draft;
  }

  private loop(opts: LoopOptions) {
    if (this.config.engine === "claude-code") return new ClaudeCodeLoop(this.config, this.bus, this.control, opts);
    const client = this.deps.client();
    if (!client) throw new Error("No API client for the anthropic engine.");
    return new AgentLoop(client, this.config, this.bus, this.control, opts);
  }

  async run(): Promise<{ ok: boolean; summary: string }> {
    const started = Date.now();
    const source = sourceOf(this.job);
    const focus = this.job.focus?.trim() ?? "";
    // ---- Read or attach the source ----
    this.bus.emitEvent({ type: "phase.started", phase: "plan", round: 0 });
    let sourceText = fs.existsSync(this.sourcePath()) ? fs.readFileSync(this.sourcePath(), "utf8") : "";
    if (source.kind === "url" && !sourceText) {
      const fetchText = this.deps.fetchText ?? (async (url: string, signal: AbortSignal) => {
        const res = await fetch(url, { signal, headers: { "user-agent": "reins/0.1 (lesson intake)" } });
        return { status: res.status, text: await res.text() };
      });
      const r = await fetchText(source.url, this.control.signal);
      if (r.status >= 400) throw new Error(`Fetching ${source.url} returned HTTP ${r.status}.`);
      sourceText = htmlToText(r.text).slice(0, MAX_SOURCE_CHARS);
      fs.writeFileSync(this.sourcePath(), sourceText);
      this.bus.emitEvent({ type: "note", level: "info", text: `Fetched ${source.url}: ${sourceText.length} characters saved to source.md.` });
    }
    // Whole sources are hashed up front, so a re-paste of an adopted article is refused before the model runs.
    let hash = "";
    if (!explored(source)) {
      hash = sourceHash(sourceText);
      const dup = findDuplicate({ hash, url: this.job.url, focus }, this.job.id);
      if (dup) throw new IntakeRefused(duplicateMessage(dup), dup);
      this.job.hash = hash;
      saveJob(this.dir, this.job);
    }
    let mcp: McpSource | null = null;
    const extraTools: Record<string, import("../tools/registry.js").ToolDef> = {};
    const extraMcpServers: Record<string, McpServerSpec> = {};
    if (source.kind === "repo") {
      const ws = this.config.workspace;
      if (!fs.existsSync(ws)) {
        this.bus.emitEvent({ type: "note", level: "info", text: `Cloning ${source.repo}${source.ref ? ` at ${source.ref}` : ""} (shallow) into ${ws}…` });
        await cloneRepo(source.repo, source.ref, ws, this.control.signal);
      }
      this.bus.emitEvent({ type: "note", level: "info", text: `Reading repository ${source.repo} at ${ws}.` });
    } else if (source.kind === "mcp") {
      if (this.config.engine === "claude-code") extraMcpServers[source.server.name] = source.server;
      else {
        mcp = await (this.deps.mcpSource ?? connectMcpSource)(source.server);
        Object.assign(extraTools, mcp.tools);
      }
      this.bus.emitEvent({ type: "note", level: "info", text: `Attached MCP server ${source.server.name}${mcp ? ` with ${Object.keys(mcp.tools).length} tools` : ""}.` });
    }

    // ---- What the librarian read: for an explored source, source.md is built from its tool results ----
    const corpus: string[] = [];
    const seenFiles = new Set<string>();
    const record = (r: { name: string; input: unknown; output: string; ok: boolean }) => {
      // Only what came from the source counts: never the model's own think notes or the proposal's echo.
      if (!r.ok || !explored(source) || UNQUOTABLE.has(r.name.replace(/^mcp__reins__/, ""))) return;
      const inp = (r.input ?? {}) as Record<string, unknown>;
      // A file read is recorded from disk, whole, so a quote may span the numbered lines the tool printed.
      if (r.name === "read_file" || r.name === "Read") {
        const rel = String(inp.path ?? inp.file_path ?? "");
        const abs = path.isAbsolute(rel) ? rel : path.join(this.config.workspace, rel);
        if (seenFiles.has(abs)) return;
        try {
          if (fs.statSync(abs).isFile() && fs.statSync(abs).size <= MAX_SOURCE_CHARS) {
            seenFiles.add(abs);
            corpus.push(`# ${path.relative(this.config.workspace, abs) || abs}\n\n${fs.readFileSync(abs, "utf8")}`);
            return;
          }
        } catch {
          /* not a file: fall through to the tool's own output */
        }
      }
      if (r.output.trim()) corpus.push(`# ${r.name}(${JSON.stringify(inp).slice(0, 200)})\n\n${r.output}`);
    };
    const textNow = () => (explored(source) ? corpus.join("\n\n") : sourceText);

    const skills = loadSkills(null).map((s) => s.name);
    const targets = [
      `# Targets you may use`,
      `- component: ${COMPONENT_IDS.join(", ")}`,
      `- stage: ${PHASES.join(", ")}`,
      `- skill: ${skills.join(", ") || "(none installed)"}`,
      `- foundation: ${FOUNDATIONS.map((f) => f.id).join(", ")}`,
      `- gap: no target (an idea Reins does not implement yet)`,
    ].join("\n");
    const today = new Date().toISOString().slice(0, 10);
    const focusBlock = focus ? `# What to look for\n${focus}` : "";
    let first: string;
    let tools: string[];
    if (source.kind === "repo") {
      first = [
        `# Source: git repository ${source.repo}${source.ref ? ` (${source.ref})` : ""}\nChecked out at ${this.config.workspace}. Top-level entries:\n${repoOutline(this.config.workspace)}`,
        focusBlock,
        targets,
        `# Instructions`,
        `Explore the repository with the file tools, guided by what to look for: list and search first, then read the files that matter (code, docs, comments, commit messages are all fair sources). Then distil what you found into one lesson and call propose_lesson. Every implication must quote a file you read verbatim (copy the words exactly; a code line counts). Learnings keep the repository's own names, numbers and examples. Use today's date (${today}).`,
      ].filter(Boolean).join("\n\n");
      tools = ["read_file", "list_files", "search", "think"];
    } else if (source.kind === "mcp") {
      const toolList = mcp ? mcp.describe() : `attached as mcp__${source.server.name}__* (listed with your tools)`;
      first = [
        `# Source: MCP server ${source.server.name}\nIts tools:\n${toolList}`,
        focusBlock,
        targets,
        `# Instructions`,
        `Read the source through the server's tools, guided by what to look for: search or list first, then read the items that matter. Then distil what you found into one lesson and call propose_lesson. Every implication must quote a tool result verbatim (copy the words exactly). Learnings keep the source's own names, numbers and examples. Use today's date (${today}) only if the source has none.`,
      ].filter(Boolean).join("\n\n");
      tools = ["think", ...Object.keys(extraTools)];
    } else {
      first = [
        `# Source (source.md, ${sourceText.length} characters${source.kind === "url" ? `, from ${source.url}` : ", pasted"})`,
        sourceText,
        focusBlock,
        targets,
        `# Instructions`,
        `Distil the source into one lesson and call propose_lesson.${focus ? " Keep to what to look for: implications outside it do not belong in this lesson." : ""} Every implication must quote the source verbatim (copy the words exactly) and target one thing. Use today's date (${today}) only if the source has none.`,
      ].filter(Boolean).join("\n\n");
      tools = ["read_file", "think", "http_fetch"];
    }
    let r;
    try {
      r = await this.loop({
        role: "librarian",
        system: librarianPrompt(),
        tools,
        terminal: ["propose_lesson"],
        extraTools,
        extraMcpServers,
        onToolResult: record,
        handlers: {
          propose_lesson: (input: DraftLesson) => {
            const d = normalizeDraft(input, this.job);
            const problems = draftProblems(d, textNow());
            if (problems.length) throw new Error(`Not proposed; fix these and call propose_lesson again:\n- ${problems.join("\n- ")}`);
            this.draft = d;
            fs.writeFileSync(path.join(this.dir, "draft.md"), renderLessonMarkdown(d, { standing: "unreviewed", focus }));
            return `Proposed ${d.implications.length} implications; the user reviews them next.`;
          },
        },
        maxTurns: this.config.maxTurnsPerPhase,
      }).run(first);
    } finally {
      await mcp?.close().catch(() => {});
    }
    if (explored(source)) {
      // What the librarian read is the source the quotes are checked against, now and by lessons:check later.
      sourceText = corpus.join("\n\n");
      fs.writeFileSync(this.sourcePath(), sourceText);
      hash = sourceHash(sourceText);
      this.job.hash = hash;
      saveJob(this.dir, this.job);
      this.bus.emitEvent({ type: "note", level: "info", text: `Recorded what the librarian read: ${seenFiles.size} file(s), ${corpus.length} item(s), ${sourceText.length} characters in source.md.` });
    }
    this.bus.emitEvent({ type: "phase.finished", phase: "plan", round: 0, summary: this.draft ? `Draft with ${this.draft.implications.length} implications.` : "No draft.", usage: r.usage, costUsd: r.costUsd, durationMs: Date.now() - started });
    if (!this.draft) {
      this.job.status = r.reason === "aborted" ? "cancelled" : "failed";
      if (this.job.status === "failed") this.job.reason = "The librarian did not propose a lesson.";
      saveJob(this.dir, this.job);
      return this.finish(false, r.reason === "aborted" ? "Cancelled." : "The librarian did not propose a lesson.", started, r.costUsd);
    }

    // ---- Check (hook) and approval ----
    this.draft = await this.check(this.draft, sourceText);
    // draft.json lets a restarted server put the same approval card back (IntakeManager.recover).
    fs.writeFileSync(path.join(this.dir, "draft.json"), JSON.stringify(this.draft, null, 2));
    return this.approveAndAdopt(this.draft, sourceText, hash, started, r.usage, r.costUsd);
  }

  /** After a server restart: show the saved draft's approval card again, then adopt as usual. */
  async resume(): Promise<{ ok: boolean; summary: string }> {
    const started = Date.now();
    const sourceText = fs.existsSync(this.sourcePath()) ? fs.readFileSync(this.sourcePath(), "utf8") : "";
    const draft = JSON.parse(fs.readFileSync(path.join(this.dir, "draft.json"), "utf8")) as DraftLesson;
    this.draft = draft;
    this.bus.emitEvent({ type: "note", level: "info", text: "The server restarted while this draft waited for approval; the approval card is back." });
    return this.approveAndAdopt(draft, sourceText, this.job.hash ?? sourceHash(sourceText), started, emptyUsage(), 0);
  }

  private async approveAndAdopt(draft: DraftLesson, sourceText: string, hash: string, started: number, usage: Usage, cost: number): Promise<{ ok: boolean; summary: string }> {
    this.job.status = "waiting_approval";
    saveJob(this.dir, this.job);
    const a = await this.control.requestLessonApproval(draft);
    if (!a.approved) {
      this.job.status = this.control.signal.aborted ? "cancelled" : "rejected";
      saveJob(this.dir, this.job);
      return this.finish(false, this.control.signal.aborted ? "Cancelled." : `Draft rejected${a.note ? `: ${a.note}` : "."}`, started, cost);
    }

    // ---- Adopt ----
    this.bus.emitEvent({ type: "phase.started", phase: "wrapup", round: 0 });
    const kept = (a.edits?.implications ?? draft.implications).map((i) => ({ ...i, domains: Array.isArray(i.domains) ? i.domains : [] }));
    const final: DraftLesson = { ...draft, implications: kept };
    const problems = draftProblems(final, sourceText);
    if (problems.length) {
      this.bus.emitEvent({ type: "phase.finished", phase: "wrapup", round: 0, summary: "Not adopted.", usage, costUsd: 0, durationMs: 0 });
      this.job.status = "failed";
      saveJob(this.dir, this.job);
      return this.finish(false, `Not adopted: ${problems.join("; ")}`, started, cost);
    }
    const standing: Standing = a.edits?.standing === "reviewed" ? "reviewed" : "unreviewed";
    let slug = final.slug;
    for (let n = 2; fs.existsSync(path.join(userLessonsDir(), `${slug}.md`)); n++) slug = `${final.slug}-${n}`;
    const file = writeUserLesson(slug, renderLessonMarkdown({ ...final, slug }, { standing, hash, focus: this.job.focus }));
    this.job.status = "adopted";
    this.job.lessonFile = file;
    this.job.lessonSlug = slug;
    saveJob(this.dir, this.job);
    this.bus.emitEvent({ type: "note", level: "info", text: `Adopted: wrote ${file} (${kept.length} implications, standing ${standing}).` });
    this.bus.emitEvent({ type: "phase.finished", phase: "wrapup", round: 0, summary: `Adopted as ${slug}.`, usage, costUsd: 0, durationMs: 0 });
    return this.finish(true, `Adopted lesson ${slug} (${standing}).`, started, cost);
  }

  private finish(ok: boolean, summary: string, started: number, costUsd: number) {
    this.bus.emitEvent({ type: "run.summary", summary, costUsd, durationMs: Date.now() - started });
    return { ok, summary };
  }
}

function normalizeDraft(input: any, job: IntakeJobFile): DraftLesson {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim()) : []);
  return {
    slug: slugify(String(input?.slug || job.slug)),
    title: String(input?.title ?? "").trim() || job.slug,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(input?.date)) ? String(input.date) : new Date().toISOString().slice(0, 10),
    url: String(input?.url || (/^https?:\/\//i.test(job.url ?? "") ? job.url : "")),
    // A repository or MCP server is a fact of the job, not the librarian's call; a whole source may be a post, paper, note…
    source: explored(sourceOf(job)) ? defaultProvenance(sourceOf(job)) : PROVENANCES.includes(input?.source) ? input.source : defaultProvenance(sourceOf(job)),
    takeaway: String(input?.takeaway ?? "").trim(),
    tags: arr(input?.tags).map((t) => t.toLowerCase()),
    learnings: arr(input?.learnings),
    implications: (Array.isArray(input?.implications) ? input.implications : []).map((i: any) => ({
      kind: (IMPLICATION_KINDS as string[]).includes(i?.kind) ? i.kind : "gap",
      target: i?.kind === "gap" ? "" : String(i?.target ?? "").trim(),
      claim: String(i?.claim ?? "").trim(),
      quote: String(i?.quote ?? "").trim(),
      domains: arr(i?.domains).map((d) => d.toLowerCase()),
    })),
  };
}

function defaultProvenance(src: IntakeSourceSpec): LessonProvenance {
  return src.kind === "repo" ? "repo" : src.kind === "mcp" ? "mcp" : src.kind === "url" ? "article" : "note";
}

function saveJob(dir: string, job: IntakeJobFile) {
  fs.mkdirSync(dir, { recursive: true });
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job, null, 2));
}

function jobDirs(): { dir: string; job: IntakeJobFile }[] {
  const root = userLessonsDir();
  const out: { dir: string; job: IntakeJobFile }[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const n of names) {
    const dir = path.join(root, n);
    try {
      const job = JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf8")) as IntakeJobFile;
      if (isIntakeId(job.id)) out.push({ dir, job });
    } catch {
      /* not a job dir */
    }
  }
  return out;
}

const sameFocus = (a?: string, b?: string) => normalizeForQuote(a ?? "") === normalizeForQuote(b ?? "");

/**
 * An existing lesson, or an intake job still in progress, with the same content
 * hash, or the same URL (page, repository or mcp://name) and the same focus; null
 * if none. The same source with another focus is another lesson.
 */
export function findDuplicate(src: { hash?: string; url?: string; focus?: string }, selfId?: string, active?: (id: string) => boolean): IntakeDuplicate | null {
  const url = src.url?.trim().replace(/\/+$/, "");
  for (const l of listLessons()) {
    if (src.hash && l.hash === src.hash) return { kind: "lesson", slug: l.slug };
    if (url && l.url && l.url.replace(/\/+$/, "") === url && sameFocus(l.focus, src.focus)) return { kind: "lesson", slug: l.slug, sameUrl: true };
  }
  for (const { job } of jobDirs()) {
    // Only a job that can still finish blocks a re-intake; adopted ones are caught above through their lesson file.
    if (job.id === selfId || !["running", "waiting_approval"].includes(job.status)) continue;
    if (active && !active(job.id)) continue;
    if (src.hash && job.hash === src.hash) return { kind: "job", slug: job.slug, jobId: job.id, status: job.status };
    if (url && job.url && job.url.replace(/\/+$/, "") === url && sameFocus(job.focus, src.focus)) return { kind: "job", slug: job.slug, jobId: job.id, status: job.status, sameUrl: true };
  }
  return null;
}

/** What POST /api/intake and IntakeManager.start accept. */
export interface IntakeStartInput {
  url?: string;
  text?: string;
  /** A git URL (http(s), ssh, git@ or file://) to clone, or a local directory to read in place. */
  repo?: string;
  ref?: string;
  /** A configured MCP server by name (resolved from Claude Code's config), or a full spec with command or url. */
  mcp?: Partial<McpServerSpec> & { name: string };
  /** What to look for; required with repo or mcp. */
  focus?: string;
  title?: string;
  engine?: EngineId;
}

const REMOTE_REPO = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/i;

/** Resolve the start input into a source, or throw with what is wrong. Returns the duplicate key and workspace too. */
export function resolveSource(input: IntakeStartInput, dir: string): { source: IntakeSourceSpec; url?: string; text?: string; workspace: string } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const url = str(input.url);
  const repo = str(input.repo);
  const focus = str(input.focus);
  const given = [url && "url", input.text?.trim() && "text", repo && "repo", input.mcp && "mcp"].filter(Boolean);
  if (given.length > 1) throw new Error(`give one source, not ${given.join(" and ")}`);
  if (repo) {
    if (!focus) throw new Error("say what to look for in the repository (focus)");
    const ref = str(input.ref);
    if (ref && !/^[\w./-]+$/.test(ref)) throw new Error("ref must be a branch or tag name");
    const local = repo.replace(/^~(?=$|\/)/, os.homedir());
    if (fs.existsSync(local)) {
      if (!fs.statSync(local).isDirectory()) throw new Error(`${repo} is not a directory`);
      const abs = path.resolve(local);
      return { source: { kind: "repo", repo: abs, ...(ref ? { ref } : {}) }, url: abs, workspace: abs };
    }
    if (!REMOTE_REPO.test(repo)) throw new Error(`${repo} is neither a directory on this machine nor a git URL`);
    return { source: { kind: "repo", repo, ...(ref ? { ref } : {}) }, url: repo, workspace: path.join(dir, "repo") };
  }
  if (input.mcp) {
    if (!focus) throw new Error("say what to look for on the MCP server (focus)");
    const server = resolveMcpInput(input.mcp, process.env.REINS_WORKSPACE ?? process.cwd());
    return { source: { kind: "mcp", server }, url: `mcp://${server.name}`, workspace: dir };
  }
  const text = typeof input.text === "string" && input.text.trim() ? input.text.slice(0, MAX_SOURCE_CHARS) : undefined;
  if (!url && !text) throw new Error("give a url, paste the text, name a repository or an MCP server");
  if (url && !/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
  return url ? { source: { kind: "url", url }, url, workspace: dir } : { source: { kind: "text" }, text, workspace: dir };
}

/** Owns intake jobs: start, events, approvals, cancel. Mirrors RunManager but never touches the runs directory. */
export class IntakeManager extends EventEmitter {
  private active = new Map<string, ActiveJob>();
  constructor(private deps: IntakeDeps) {
    super();
  }

  /**
   * Call once at server start. A job left waiting for approval comes back with its
   * approval card (from draft.json); a job whose librarian was cut off mid-run is
   * marked interrupted, so its source can be taken in again.
   */
  recover(): { resumed: string[]; interrupted: string[] } {
    const out = { resumed: [] as string[], interrupted: [] as string[] };
    for (const { dir, job } of jobDirs()) {
      if (this.active.has(job.id) || !["running", "waiting_approval"].includes(job.status)) continue;
      const config = this.config(job.id);
      if (job.status === "waiting_approval" && config && fs.existsSync(path.join(dir, "draft.json"))) {
        const run = this.track(config, dir);
        const evs = this.events(job.id);
        const resolved = new Set(evs.flatMap((e) => (e.type === "approval.resolved" ? [e.approvalId] : [])));
        const open = evs.flatMap((e) => (e.type === "approval.requested" && e.request.kind === "lesson" && !resolved.has(e.request.approvalId) ? [e.request] : []));
        run.reopen = open.at(-1);
        void this.drive(run, job, "resume");
        out.resumed.push(job.id);
        continue;
      }
      job.status = "interrupted";
      job.reason = "The server stopped before this job finished.";
      saveJob(dir, job);
      const bus = new RunBus(job.id, true, fileEventStore(path.join(dir, "events.jsonl")));
      bus.on("event", (ev: RunEvent) => this.emit("event", ev));
      bus.emitEvent({ type: "error", message: `${job.reason} Start the intake again from Lessons.`, recoverable: false });
      bus.emitEvent({ type: "run.status", status: "failed", reason: job.reason });
      out.interrupted.push(job.id);
    }
    return out;
  }

  private track(config: RunConfig, dir: string): ActiveJob {
    const bus = new RunBus(config.id, true, fileEventStore(path.join(dir, "events.jsonl")));
    const run: ActiveJob = { config, bus, abort: new AbortController(), pending: new Map(), dir };
    bus.on("event", (ev: RunEvent) => this.emit("event", ev));
    this.active.set(config.id, run);
    return run;
  }

  private dirFor(id: string): string | null {
    if (!isIntakeId(id)) return null;
    const slug = id.slice(INTAKE_PREFIX.length);
    if (!LESSON_SLUG.test(slug)) return null;
    return path.join(userLessonsDir(), slug);
  }

  /** Every intake job, newest first, with whether it is live in this server (it can be approved or cancelled). */
  list(): (IntakeJobFile & { active: boolean })[] {
    return jobDirs()
      .map((j) => ({ ...j.job, active: this.active.has(j.job.id) }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  events(id: string, fromSeq = 0): RunEvent[] {
    const dir = this.dirFor(id);
    return dir ? readEventFile(path.join(dir, "events.jsonl"), fromSeq) : [];
  }

  config(id: string): RunConfig | null {
    const created = this.events(id).find((e) => e.type === "run.created") as Extract<RunEvent, { type: "run.created" }> | undefined;
    return created?.config ?? null;
  }

  pendingApprovals(id: string): ApprovalRequest[] {
    return [...(this.active.get(id)?.pending.values() ?? [])].map((p) => p.request);
  }

  isActive(id: string) {
    return this.active.has(id);
  }

  /** Start a job from a URL, pasted text, a git repository or an MCP server. Throws IntakeRefused for a duplicate source. */
  start(input: IntakeStartInput): { id: string; slug: string } {
    const focus = typeof input.focus === "string" && input.focus.trim() ? input.focus.trim().slice(0, 1000) : undefined;
    // The source is resolved against a placeholder dir first (only a remote clone needs the real one).
    const probe = resolveSource(input, "");
    const { url, text } = probe;
    const dup = findDuplicate({ url, hash: text ? sourceHash(text) : undefined, focus }, undefined, (id) => this.active.has(id));
    if (dup) throw new IntakeRefused(duplicateMessage(dup), dup);
    const firstLine = text?.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") ?? "";
    const src = probe.source;
    const baseName =
      src.kind === "repo"
        ? path.basename(src.repo.replace(/\/+$/, "").replace(/\.git$/, "")) || "repo"
        : src.kind === "mcp"
          ? src.server.name
          : src.kind === "url"
            ? (new URL(src.url).pathname.split("/").filter(Boolean).pop() ?? new URL(src.url).hostname)
            : firstLine;
    // An explored source is named after what was looked for, so two lessons from one repository tell apart.
    const base = slugify(input.title || (explored(src) && focus ? `${baseName}-${slugify(focus).slice(0, 32)}` : baseName));
    let slug = base;
    for (let n = 2; fs.existsSync(path.join(userLessonsDir(), slug)) || fs.existsSync(path.join(userLessonsDir(), `${slug}.md`)); n++) slug = `${base}-${n}`;
    const id = `${INTAKE_PREFIX}${slug}`;
    const dir = path.join(userLessonsDir(), slug);
    fs.mkdirSync(dir, { recursive: true });
    const { source, workspace } = resolveSource(input, dir);
    if (text) fs.writeFileSync(path.join(dir, "source.md"), text);
    const job: IntakeJobFile = { id, slug, ...(url ? { url } : {}), source, ...(focus ? { focus } : {}), ...(text ? { hash: sourceHash(text) } : {}), status: "running", createdAt: new Date().toISOString() };
    saveJob(dir, job);
    const engine: EngineId = input.engine ?? (this.deps.client() ? "anthropic" : this.deps.hasClaudeCode() ? "claude-code" : "anthropic");
    const off = Object.fromEntries(COMPONENT_IDS.map((c) => [c, false])) as RunConfig["components"];
    const config = defaultRunConfig({
      id,
      title: `Lesson intake: ${slug}`,
      task: `Distil ${describeSource(source)} into a lesson with typed implications${focus ? `, looking for: ${focus}` : ""}.`,
      workspace,
      engine,
      // Network is allowed for this job only; nothing else is switched on.
      components: { ...off, thinkTool: true, narration: true },
      guardrail: { mode: "auto", allowNetwork: true, askPatterns: [], denyPatterns: [] },
      pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false },
      // An intake job is a low-effort run: one builder session, no evaluation (EFFORT_TABLE.low).
      budgetUsd: EFFORT_TABLE.low.budgetUsd,
      budgetTokens: EFFORT_TABLE.low.budgetTokens,
      maxTurnsPerPhase: EFFORT_TABLE.low.maxTurnsPerPhase,
      maxFixRounds: EFFORT_TABLE.low.maxFixRounds,
    });
    (config as RunConfig).job = "intake";
    const run = this.track(config, dir);
    run.bus.emitEvent({ type: "run.created", config });
    void this.drive(run, job, "start");
    return { id, slug };
  }

  private status(run: ActiveJob, status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled", reason?: string) {
    run.bus.emitEvent({ type: "run.status", status, reason });
  }

  private async drive(run: ActiveJob, job: IntakeJobFile, mode: "start" | "resume") {
    // Ask the person, then put the job back to running once they answer (a cancel resolves it as rejected).
    const ask = async <T>(request: Omit<ApprovalRequest, "approvalId">) => {
      const r = await new Promise<{ approved: boolean; note?: string; edits?: T }>((resolve) => {
        if (run.abort.signal.aborted) return resolve({ approved: false, note: "cancelled" });
        const reopen = run.reopen && run.reopen.kind === request.kind ? run.reopen : undefined;
        run.reopen = undefined;
        const approvalId = reopen?.approvalId ?? nanoid(8);
        const full = { ...request, approvalId };
        run.pending.set(approvalId, { request: full, resolve: resolve as any });
        if (!reopen) run.bus.emitEvent({ type: "approval.requested", request: full });
        this.status(run, "waiting_approval");
        run.abort.signal.addEventListener("abort", () => resolve({ approved: false, note: "cancelled" }), { once: true });
      });
      if (!run.abort.signal.aborted) this.status(run, "running");
      return r;
    };
    const control = {
      signal: run.abort.signal,
      waitIfPaused: async () => {},
      drainSteer: () => [],
      remainingBudget: () => budgetOf(run.config).limit,
      requestApproval: (_k: "action", title: string, detail: string, payload: unknown) => ask({ kind: "action", title, detail, payload }),
      requestLessonApproval: (draft: DraftLesson) => ask<LessonEdits>({ kind: "lesson", title: "Review the distilled lesson", detail: "Edit or drop implications, set the standing, then approve to add it to your library.", payload: draft }),
    };
    if (mode === "start") this.status(run, "running");
    try {
      if (mode === "resume") {
        const orch = new IntakeOrchestrator(job, run.config, run.bus, control, this.deps, run.dir);
        const { ok, summary } = await orch.resume();
        this.status(run, run.abort.signal.aborted ? "cancelled" : ok ? "completed" : "failed", summary);
        return;
      }
      if (run.config.engine === "anthropic" && !this.deps.client()) throw new Error("No API key configured for the librarian. Add one in Settings, or use the Claude Code engine.");
      const orch = new IntakeOrchestrator(job, run.config, run.bus, control, this.deps, run.dir);
      const { ok, summary } = await orch.run();
      this.status(run, run.abort.signal.aborted ? "cancelled" : ok ? "completed" : "failed", summary);
    } catch (err) {
      const refused = err instanceof IntakeRefused;
      job.status = refused ? "refused" : run.abort.signal.aborted ? "cancelled" : "failed";
      job.reason = (err as Error).message;
      saveJob(run.dir, job);
      run.bus.emitEvent({ type: "error", message: (err as Error).message, recoverable: false });
      this.status(run, run.abort.signal.aborted ? "cancelled" : "failed", (err as Error).message);
    } finally {
      this.active.delete(run.config.id);
    }
  }

  /** Answer a pending card. A lesson draft is adopted or dropped; "revise" is not offered here and counts as a rejection. */
  approve(id: string, approvalId: string, decision: ApprovalDecision, note?: string, edits?: LessonEdits) {
    const run = this.active.get(id);
    const p = run?.pending.get(approvalId);
    if (!run || !p) throw new Error("No such pending approval.");
    run.pending.delete(approvalId);
    run.bus.emitEvent({ type: "approval.resolved", approvalId, decision, note });
    p.resolve({ approved: decision === "approve", note, edits });
  }

  cancel(id: string) {
    const run = this.active.get(id);
    if (!run) throw new Error("Job is not active.");
    run.abort.abort();
  }

  /** Resolves when the job is no longer active (tests, scripts). */
  async settled(id: string, timeoutMs = 10_000): Promise<void> {
    const t0 = Date.now();
    while (this.active.has(id) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 20));
  }
}
