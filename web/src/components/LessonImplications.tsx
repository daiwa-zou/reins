import React, { useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import type { Implication, ImplicationKind, IntakeJobSummary, Lesson, McpServerSpec, Standing } from "@shared/types";
import { useStore } from "../state/store";
import { api, IntakeRefusedError, type LessonDerived } from "../lib/api";
import { Badge } from "./ui";
import { describeSource, detectSource, needsFocus } from "@shared/intakeInput";
import { dateTime } from "../lib/format";

const KIND_LABEL: Record<ImplicationKind, string> = { component: "Components", stage: "Stages", skill: "Skills", foundation: "Foundations", gap: "Ideas (gaps)", effort: "Effort recommendations" };
const KINDS: ImplicationKind[] = ["component", "stage", "skill", "foundation", "effort", "gap"];

/** A lesson's implications grouped by kind; each target links to where it lives in Reins. */
export function ImplicationsByKind({ lesson }: { lesson: Lesson }) {
  const navigate = useStore((s) => s.navigate);
  const components = useStore((s) => s.components);
  const items = (lesson.items ?? []).filter((i) => !i.implicit);
  const target = (i: Implication) => {
    if (!i.target) return null;
    const label = i.kind === "component" ? (components.find((c) => c.id === i.target)?.label ?? i.target) : i.target;
    // A skill has a row in the installed skills list on Harness (#skill-<name>); a component,
    // foundation or stage target filters the library to the lessons behind it.
    const go = () => {
      const t = i.target!;
      if (i.kind === "skill") navigate({ section: "harness", skill: t, component: null });
      else if (i.kind === "stage") navigate({ section: "lessons", component: "stageLessons", skill: null, lesson: null });
      else navigate({ section: "lessons", component: t, skill: null, lesson: null });
    };
    const title =
      i.kind === "stage"
        ? `Goes into the ${i.target} phase's first message via "Lessons for this stage"; show the lessons behind that component`
        : i.kind === "skill"
          ? `Open the ${i.target} skill in Harness › Skills`
          : `Show every lesson behind the ${i.kind} ${label}`;
    return (
      <button className={`badge ${i.kind === "component" ? "badge-accent" : "badge-neutral"} hover:brightness-95 mr-1.5`} onClick={go} title={title} data-target-kind={i.kind} data-target={i.target}>
        {i.kind === "stage" ? `stage: ${label}` : i.kind === "skill" ? `skill: ${label}` : label}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {KINDS.map((k) => {
        const of = items.filter((i) => i.kind === k);
        if (!of.length) return null;
        return (
          <div key={k}>
            <div className="text-[11.5px] font-semibold muted mb-1">{KIND_LABEL[k]}</div>
            <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed">
              {of.map((i) => (
                <li key={i.id}>
                  {target(i)}
                  {i.claim}
                  {i.domains.length > 0 && <span className="muted text-[11px]"> · {i.domains.join(", ")}</span>}
                  {i.standing === "unreviewed" && (
                    <Badge tone="warn" title="Unreviewed implications only appear on the Ideas list">
                      unreviewed
                    </Badge>
                  )}
                  {i.quote && <blockquote className="muted text-[11.5px] border-l-2 line pl-2 mt-0.5">“{i.quote}”</blockquote>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Standing of a user lesson: reviewed implications may enter stage blocks and presets; unreviewed ones only show as Ideas. */
const STANDING_MEANING: Record<"unreviewed" | "reviewed", string> = {
  unreviewed: "Unreviewed: its implications show only on the Ideas list and shape no run or domain.",
  reviewed: "Reviewed: its implications enter stage prompts, presets and your domains.",
};

/**
 * Standing of a user lesson as a two-way switch that says what each side does.
 * A bundled lesson is always trusted and shows a badge instead.
 */
export function StandingControl({ lesson }: { lesson: Lesson }) {
  const refreshLessons = useStore((s) => s.refreshLessons);
  const refreshDomains = useStore((s) => s.refreshDomains);
  const toastMsg = useStore((s) => s.toastMsg);
  const [busy, setBusy] = useState(false);
  if (lesson.source !== "user") return <Badge title="Shipped with Reins: always trusted">bundled</Badge>;
  const set = async (standing: "reviewed" | "unreviewed") => {
    if (standing === lesson.standing || busy) return;
    setBusy(true);
    try {
      await api.setStanding(lesson.slug, standing);
      await Promise.all([refreshLessons(), refreshDomains()]);
      toastMsg(standing === "reviewed" ? "Reviewed: its implications now shape runs and domains." : "Unreviewed: its implications are ideas only now.");
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2" data-standing={lesson.standing}>
      <span className="seg" role="radiogroup" aria-label="Standing" aria-busy={busy}>
        {(["unreviewed", "reviewed"] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={lesson.standing === s} disabled={busy} title={STANDING_MEANING[s]} onClick={() => set(s)} data-standing-option={s}>
            {s}
          </button>
        ))}
      </span>
      <span className="faint text-caption hidden lg:inline" aria-hidden>
        {lesson.standing === "reviewed" ? "shapes runs and domains" : "ideas only"}
      </span>
    </span>
  );
}

/** One line per derived thing a delete removes, so the confirmation says exactly what goes. */
export function derivedLines(d: LessonDerived): string[] {
  const out: string[] = [];
  for (const dir of d.intakeJobs) out.push(`the intake job folder ${dir.split("/").pop()}/ (its source, draft and events)`);
  for (const x of d.domains) out.push(x.deleted ? `your domain "${x.label}", built only from this lesson` : `${x.dropped.length} implication${x.dropped.length === 1 ? "" : "s"} from your domain "${x.label}"`);
  for (const p of d.presets) out.push(p.deleted ? `your preset "${p.name}", built only on this lesson` : `this lesson from the basis of your preset "${p.name}"`);
  if (d.revealsBundled) out.push("nothing else; the bundled lesson of the same name shows again");
  return out;
}

/**
 * Delete a lesson from your library together with what was derived from it.
 * Opens a confirmation that lists exactly what goes (from GET derived) before
 * anything is removed.
 */
export function DeleteLesson({ lesson, onDeleted }: { lesson: Lesson; onDeleted: (d: LessonDerived) => void }) {
  const [derived, setDerived] = useState<LessonDerived | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (lesson.source !== "user") return null;
  const open = async () => {
    setErr(null);
    setBusy(true);
    try {
      setDerived(await api.lessonDerived(lesson.slug));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      const d = await api.deleteLesson(lesson.slug);
      setDerived(null);
      onDeleted(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const lines = derived ? derivedLines(derived) : [];
  return (
    <span className="inline-flex items-center gap-1.5">
      {!derived && (
        <button type="button" className="icon-btn btn-danger" onClick={open} disabled={busy} data-delete-lesson={lesson.slug} aria-label="Delete this lesson" title="Delete this lesson and everything derived from it">
          <Trash2 size={14} aria-hidden />
        </button>
      )}
      {err && (
        <span className="text-[11px] text-red-600" role="alert">
          {err}
        </span>
      )}
      {derived && (
        <div className="card p-3 text-[12.5px] flex flex-col gap-2 absolute right-5 z-10 max-w-md" style={{ borderColor: "var(--bad)", top: "3.5rem" }} role="dialog" aria-label={`Delete lesson ${lesson.slug}`} data-delete-lesson-confirm>
          <div className="font-semibold">Delete “{lesson.title}”?</div>
          <div className="muted">
            This removes <span className="mono">{derived.file.split("/").pop()}</span> from your library
            {lines.length ? " and, with it:" : ". Nothing else was derived from it."}
          </div>
          {lines.length > 0 && (
            <ul className="list-disc pl-5 flex flex-col gap-0.5">
              {lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          <div className="muted text-[11.5px]">Runs keep the stage lessons they were created with. Generated presets and stage blocks follow the library on their own.</div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm btn-danger" onClick={confirm} disabled={busy} data-delete-lesson-confirm-button>
              {busy ? "Deleting…" : `Delete lesson${lines.length ? ` and ${lines.length} derived item${lines.length === 1 ? "" : "s"}` : ""}`}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setDerived(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/** Start a lesson intake job from a URL or pasted text; its events open on the Stage like a run. */
/** `inline`: shown already open, e.g. inside the Lessons "Add a lesson" card. */
type SourceKind = "url" | "text" | "repo" | "mcp";
/**
 * Lesson intake as one box: paste a web address, a repository or folder, the
 * name of an MCP server Claude Code has configured, or the text itself; the
 * form says how it will read it. Explored sources (a repository, a server) ask
 * what to look for; the rest take it as an optional hint.
 */
export function IntakeForm({ inline = false }: { inline?: boolean } = {}) {
  const selectRun = useStore((s) => s.selectRun);
  const refreshIntake = useStore((s) => s.refreshIntake);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const [raw, setRaw] = useState("");
  const [focus, setFocus] = useState("");
  const [servers, setServers] = useState<{ name: string; from: "project" | "local" | "user" }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<IntakeRefusedError["duplicate"]>(null);
  useEffect(() => {
    api
      .mcpServers()
      .then(setServers)
      .catch(() => setServers([]));
  }, []);
  const detected = detectSource(raw, servers.map((s) => s.name));
  const focusRequired = needsFocus(detected);
  const ready = !!detected && (!focusRequired || !!focus.trim());
  const start = async () => {
    if (!detected) return;
    setBusy(true);
    setErr(null);
    setDup(null);
    try {
      const body = detected.kind === "url" ? { url: detected.url } : detected.kind === "text" ? { text: detected.text } : detected.kind === "repo" ? { repo: detected.repo, ...(detected.ref ? { ref: detected.ref } : {}) } : { mcp: { name: detected.name } };
      const r = await api.startIntake({ ...body, ...(focus.trim() ? { focus: focus.trim() } : {}) });
      await refreshIntake();
      selectRun(r.id);
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof IntakeRefusedError) setDup(e.duplicate);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className={`${inline ? "" : "card p-3"} text-[12.5px]`} data-intake-form open={inline || undefined}>
      <summary className={inline ? "sr-only" : "cursor-pointer font-semibold"}>Add a lesson from a source…</summary>
      <p className="muted mt-1.5">A librarian distils the source into a lesson with typed implications, each quoting what it read. You review the draft before it lands in your library.</p>
      <textarea
        className="input w-full mt-2"
        rows={raw.includes("\n") || raw.length > 120 ? 5 : 2}
        placeholder="Paste a web address, a repository or folder, the name of an MCP server, or the text itself"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        aria-label="Source"
        data-intake-source
      />
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5 min-h-[20px]" data-intake-detected={detected?.kind ?? ""}>
        {detected ? (
          <span className="faint text-caption">Read as: {describeSource(detected)}</span>
        ) : (
          servers.length > 0 && (
            <>
              <span className="faint text-caption">MCP servers Claude Code knows:</span>
              {servers.map((s) => (
                <button key={s.name} type="button" className="chip chip-sm" onClick={() => setRaw(s.name)} title={`${s.from === "user" ? "Configured for you" : s.from === "project" ? "Configured in this project's .mcp.json" : "Configured for this project"}; its tools are attached to the librarian`} data-mcp-server={s.name}>
                  {s.name}
                </button>
              ))}
            </>
          )
        )}
      </div>
      <input
        className="input w-full mt-2"
        placeholder={focusRequired ? "What to look for (needed to explore it): e.g. how errors from the API are retried and reported" : "What to look for (optional): narrows the lesson to one theme"}
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        aria-label="What to look for"
        aria-required={focusRequired}
        data-intake-focus
      />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button className="btn btn-primary" disabled={busy || !ready} onClick={start} title={!detected ? "Paste a source first" : focusRequired && !focus.trim() ? "Say what to look for" : undefined} data-intake-start>
          <Play size={13} aria-hidden /> {busy ? "Starting…" : "Start intake"}
        </button>
        {err && (
          <span className="text-[var(--bad)] text-[12px]" role="alert" data-intake-error>
            {err}
          </span>
        )}
        {dup?.kind === "job" && dup.jobId && (
          <button className="btn btn-sm" onClick={() => selectRun(dup.jobId!)} data-intake-open-duplicate>
            Open intake job {dup.slug}
          </button>
        )}
        {dup?.kind === "lesson" && (
          <button className="btn btn-sm" onClick={() => setLessonFilter(dup.slug)}>
            Open lesson {dup.slug}
          </button>
        )}
      </div>
    </details>
  );
}

/** One line naming a job's source, for the jobs list. */
export function jobSourceLabel(j: IntakeJobSummary): string {
  const s = j.source;
  const base = !s ? (j.url ?? "pasted text") : s.kind === "url" ? s.url : s.kind === "text" ? "pasted text" : s.kind === "repo" ? `repository ${s.repo}${s.ref ? ` (${s.ref})` : ""}` : `MCP server ${s.server.name}`;
  return j.focus ? `${base} — looking for: ${j.focus}` : base;
}

const JOB_STATUS: Record<IntakeJobSummary["status"], { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "accent" }> = {
  running: { label: "distilling", tone: "accent" },
  waiting_approval: { label: "needs your review", tone: "warn" },
  adopted: { label: "adopted", tone: "ok" },
  rejected: { label: "rejected", tone: "neutral" },
  cancelled: { label: "cancelled", tone: "neutral" },
  refused: { label: "refused (duplicate)", tone: "neutral" },
  failed: { label: "failed", tone: "bad" },
  interrupted: { label: "interrupted", tone: "bad" },
};

/** Pending intake jobs needing review, as a one-line notice that opens the first on the Stage. */
export function IntakeNotice() {
  const jobs = useStore((s) => s.intakeJobs);
  const selectRun = useStore((s) => s.selectRun);
  const waiting = jobs.filter((j) => j.status === "waiting_approval" && j.active);
  if (!waiting.length) return null;
  return (
    <div className="card p-2.5 text-[12.5px] flex items-center gap-2" style={{ borderColor: "var(--warn)" }} role="status" data-intake-notice>
      <span className="flex-1">
        {waiting.length === 1 ? `A lesson draft (${waiting[0].slug}) is waiting for your review.` : `${waiting.length} lesson drafts are waiting for your review.`}
      </span>
      <button className="btn btn-sm btn-primary" onClick={() => selectRun(waiting[0].id)}>
        Review
      </button>
    </div>
  );
}

/** Every lesson intake job: open it on the Stage (events, approval card), cancel a live one, or jump to the adopted lesson. */
export function IntakeJobs() {
  const jobs = useStore((s) => s.intakeJobs);
  const selectRun = useStore((s) => s.selectRun);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const refreshIntake = useStore((s) => s.refreshIntake);
  const [err, setErr] = useState<string | null>(null);
  if (!jobs.length) return null;
  const cancel = async (id: string) => {
    setErr(null);
    try {
      await api.cancel(id);
      await refreshIntake();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="card p-3 text-[12.5px]" data-intake-jobs>
      <div className="font-semibold mb-1.5">Intake jobs</div>
      <ul className="flex flex-col gap-1">
        {jobs.map((j) => {
          const st = JOB_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
          const live = j.active && (j.status === "running" || j.status === "waiting_approval");
          return (
            <li key={j.id} className="flex items-center gap-2" data-intake-job={j.id}>
              <span className="flex-1 min-w-0 truncate" title={jobSourceLabel(j)}>
                <span className="mono">{j.slug}</span>
                {j.focus && <span className="muted"> · {j.focus}</span>}
              </span>
              <Badge tone={st.tone} title={j.reason}>
                {st.label}
              </Badge>
              <span className="faint text-[10.5px]">{dateTime(j.updatedAt ?? j.createdAt)}</span>
              <button className={`btn btn-sm ${j.status === "waiting_approval" && live ? "btn-primary" : ""}`} onClick={() => selectRun(j.id)} title="Open this job on the Stage">
                {j.status === "waiting_approval" && live ? "Review" : "Open"}
              </button>
              {j.status === "adopted" && j.lessonSlug && (
                <button className="btn btn-sm" onClick={() => setLessonFilter(j.lessonSlug!)}>
                  Lesson
                </button>
              )}
              {live && (
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => void cancel(j.id)} aria-label={`Cancel intake job ${j.slug}`}>
                  Cancel
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {err && <div className="text-red-600 text-[12px] mt-1">{err}</div>}
    </div>
  );
}
