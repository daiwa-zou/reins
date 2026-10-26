// Lesson intake: a separate job type, not a run. It reuses the loop classes,
// RunBus and the approval flow, but has its own orchestrator and its own
// storage under $REINS_HOME/lessons/<slug>/ (source.md, draft.md,
// events.jsonl, job.json). Intake jobs never appear in the Runs list or in
// trial sets; their events still stream to the Stage like a run's.
//
//   fetch/read source -> librarian distils (propose_lesson) -> check() hook
//   -> approval card (edit/drop implications, set standing) -> adopt
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ApprovalRequest, EngineId, ImplicationKind, LessonProvenance, RunConfig, RunEvent, Standing, Usage } from "../../../shared/types.js";
import { COMPONENT_IDS, defaultRunConfig, EFFORT_TABLE, FOUNDATIONS } from "../../../shared/components.js";
import { IMPLICATION_KINDS, LESSON_SLUG, normalizeForQuote, parseLesson, PHASES, PROVENANCES, quoteInSource, renderImplication } from "../../../shared/lessons.js";
import { RunBus, type EventStore } from "../engine/bus.js";
import { AgentLoop, type LoopControl, type LoopOptions } from "../engine/loop.js";
import { ClaudeCodeLoop } from "../engine/claudeCodeLoop.js";
import { listLessons, userLessonsDir, writeUserLesson } from "../lessons.js";
import { loadSkills } from "../skills.js";
import { librarianPrompt } from "../roles/prompts.js";
import { emptyUsage } from "../engine/pricing.js";

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
  url?: string;
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

function fileStore(file: string): EventStore {
  return {
    append: (ev) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(ev) + "\n");
    },
    read: () => readEventFile(file),
  };
}

function readEventFile(file: string, fromSeq = 0): RunEvent[] {
  if (!fs.existsSync(file)) return [];
  const out: RunEvent[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as RunEvent;
      if (ev.seq >= fromSeq) out.push(ev);
    } catch {
      /* torn last line */
    }
  }
  return out;
}

/** Render a draft (plus standing and hash) to the lesson markdown format. */
export function renderLessonMarkdown(d: DraftLesson, extra: { standing: Standing; hash?: string }): string {
  const one = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
  const fm = [
    "---",
    `title: ${one(d.title)}`,
    `date: ${one(d.date)}`,
    ...(d.url ? [`url: ${one(d.url)}`] : []),
    `source: ${d.source}`,
    `standing: ${extra.standing}`,
    ...(extra.hash ? [`hash: ${extra.hash}`] : []),
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
    // ---- Distil ----
    this.bus.emitEvent({ type: "phase.started", phase: "plan", round: 0 });
    let sourceText = fs.existsSync(this.sourcePath()) ? fs.readFileSync(this.sourcePath(), "utf8") : "";
    if (!sourceText && this.job.url) {
      const fetchText = this.deps.fetchText ?? (async (url: string, signal: AbortSignal) => {
        const res = await fetch(url, { signal, headers: { "user-agent": "reins/0.1 (lesson intake)" } });
        return { status: res.status, text: await res.text() };
      });
      const r = await fetchText(this.job.url, this.control.signal);
      if (r.status >= 400) throw new Error(`Fetching ${this.job.url} returned HTTP ${r.status}.`);
      sourceText = htmlToText(r.text).slice(0, MAX_SOURCE_CHARS);
      fs.writeFileSync(this.sourcePath(), sourceText);
      this.bus.emitEvent({ type: "note", level: "info", text: `Fetched ${this.job.url}: ${sourceText.length} characters saved to source.md.` });
    }
    const hash = sourceHash(sourceText);
    const dup = findDuplicate({ hash, url: this.job.url }, this.job.id);
    if (dup) throw new IntakeRefused(duplicateMessage(dup), dup);
    this.job.hash = hash;
    saveJob(this.dir, this.job);

    const skills = loadSkills(null).map((s) => s.name);
    const first = [
      `# Source (source.md, ${sourceText.length} characters${this.job.url ? `, from ${this.job.url}` : ", pasted"})`,
      sourceText,
      `# Targets you may use`,
      `- component: ${COMPONENT_IDS.join(", ")}`,
      `- stage: ${PHASES.join(", ")}`,
      `- skill: ${skills.join(", ") || "(none installed)"}`,
      `- foundation: ${FOUNDATIONS.map((f) => f.id).join(", ")}`,
      `- gap: no target (an idea Reins does not implement yet)`,
      `# Instructions`,
      `Distil the source into one lesson and call propose_lesson. Every implication must quote the source verbatim (copy the words exactly) and target one thing. Use today's date (${new Date().toISOString().slice(0, 10)}) only if the source has none.`,
    ].join("\n\n");
    const r = await this.loop({
      role: "librarian",
      system: librarianPrompt(),
      tools: ["read_file", "think", "http_fetch"],
      terminal: ["propose_lesson"],
      handlers: {
        propose_lesson: (input: DraftLesson) => {
          const d = normalizeDraft(input, this.job);
          const problems = draftProblems(d, sourceText);
          if (problems.length) throw new Error(`Not proposed; fix these and call propose_lesson again:\n- ${problems.join("\n- ")}`);
          this.draft = d;
          fs.writeFileSync(path.join(this.dir, "draft.md"), renderLessonMarkdown(d, { standing: "unreviewed", hash }));
          return `Proposed ${d.implications.length} implications; the user reviews them next.`;
        },
      },
      maxTurns: this.config.maxTurnsPerPhase,
    }).run(first);
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
    const file = writeUserLesson(slug, renderLessonMarkdown({ ...final, slug }, { standing, hash }));
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
    url: String(input?.url || job.url || ""),
    source: PROVENANCES.includes(input?.source) ? input.source : job.url ? "article" : "note",
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

/** An existing lesson, or an intake job still in progress, with the same content hash or URL; null if none. */
export function findDuplicate(src: { hash?: string; url?: string }, selfId?: string, active?: (id: string) => boolean): IntakeDuplicate | null {
  const url = src.url?.trim().replace(/\/+$/, "");
  for (const l of listLessons()) {
    if (src.hash && l.hash === src.hash) return { kind: "lesson", slug: l.slug };
    if (url && l.url && l.url.replace(/\/+$/, "") === url) return { kind: "lesson", slug: l.slug, sameUrl: true };
  }
  for (const { job } of jobDirs()) {
    // Only a job that can still finish blocks a re-intake; adopted ones are caught above through their lesson file.
    if (job.id === selfId || !["running", "waiting_approval"].includes(job.status)) continue;
    if (active && !active(job.id)) continue;
    if (src.hash && job.hash === src.hash) return { kind: "job", slug: job.slug, jobId: job.id, status: job.status };
    if (url && job.url && job.url.replace(/\/+$/, "") === url) return { kind: "job", slug: job.slug, jobId: job.id, status: job.status, sameUrl: true };
  }
  return null;
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
      const bus = new RunBus(job.id, true, fileStore(path.join(dir, "events.jsonl")));
      bus.on("event", (ev: RunEvent) => this.emit("event", ev));
      bus.emitEvent({ type: "error", message: `${job.reason} Start the intake again from Lessons.`, recoverable: false });
      bus.emitEvent({ type: "run.status", status: "failed", reason: job.reason });
      out.interrupted.push(job.id);
    }
    return out;
  }

  private track(config: RunConfig, dir: string): ActiveJob {
    const bus = new RunBus(config.id, true, fileStore(path.join(dir, "events.jsonl")));
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

  /** Start a job from a URL or pasted text. Throws IntakeRefused for a duplicate source. */
  start(input: { url?: string; text?: string; title?: string; engine?: EngineId }): { id: string; slug: string } {
    const url = typeof input.url === "string" && input.url.trim() ? input.url.trim() : undefined;
    const text = typeof input.text === "string" && input.text.trim() ? input.text.slice(0, MAX_SOURCE_CHARS) : undefined;
    if (!url && !text) throw new Error("give a url or paste the text");
    if (url && !/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
    const dup = findDuplicate({ url, hash: text ? sourceHash(text) : undefined }, undefined, (id) => this.active.has(id));
    if (dup) throw new IntakeRefused(duplicateMessage(dup), dup);
    const firstLine = text?.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") ?? "";
    const base = slugify(input.title || (url ? (new URL(url).pathname.split("/").filter(Boolean).pop() ?? new URL(url).hostname) : firstLine));
    let slug = base;
    for (let n = 2; fs.existsSync(path.join(userLessonsDir(), slug)) || fs.existsSync(path.join(userLessonsDir(), `${slug}.md`)); n++) slug = `${base}-${n}`;
    const id = `${INTAKE_PREFIX}${slug}`;
    const dir = path.join(userLessonsDir(), slug);
    fs.mkdirSync(dir, { recursive: true });
    if (text) fs.writeFileSync(path.join(dir, "source.md"), text);
    const job: IntakeJobFile = { id, slug, ...(url ? { url } : {}), ...(text ? { hash: sourceHash(text) } : {}), status: "running", createdAt: new Date().toISOString() };
    saveJob(dir, job);
    const engine: EngineId = input.engine ?? (this.deps.client() ? "anthropic" : this.deps.hasClaudeCode() ? "claude-code" : "anthropic");
    const off = Object.fromEntries(COMPONENT_IDS.map((c) => [c, false])) as RunConfig["components"];
    const config = defaultRunConfig({
      id,
      title: `Lesson intake: ${slug}`,
      task: `Distil ${url ?? "the pasted text"} into a lesson with typed implications.`,
      workspace: dir,
      engine,
      // Network is allowed for this job only; nothing else is switched on.
      components: { ...off, thinkTool: true, narration: true },
      guardrail: { mode: "auto", allowNetwork: true, askPatterns: [], denyPatterns: [] },
      pauses: { afterPlan: false, afterContract: false, beforeCommit: false, afterEvaluation: false },
      // An intake job is a low-effort run: one builder session, no evaluation (EFFORT_TABLE.low).
      budgetUsd: EFFORT_TABLE.low.budgetUsd,
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
    const ask = <T>(request: Omit<ApprovalRequest, "approvalId">) =>
      new Promise<{ approved: boolean; note?: string; edits?: T }>((resolve) => {
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
    const control = {
      signal: run.abort.signal,
      waitIfPaused: async () => {},
      drainSteer: () => [],
      remainingBudget: () => run.config.budgetUsd,
      requestApproval: async (_k: "action", title: string, detail: string, payload: unknown) => {
        const r = await ask({ kind: "action", title, detail, payload });
        if (!run.abort.signal.aborted) this.status(run, "running");
        return r;
      },
      requestLessonApproval: async (draft: DraftLesson) => {
        const r = await ask<LessonEdits>({ kind: "lesson", title: "Review the distilled lesson", detail: "Edit or drop implications, set the standing, then approve to add it to your library.", payload: draft });
        if (!run.abort.signal.aborted) this.status(run, "running");
        return r;
      },
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

  approve(id: string, approvalId: string, decision: "approve" | "reject", note?: string, edits?: LessonEdits) {
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
