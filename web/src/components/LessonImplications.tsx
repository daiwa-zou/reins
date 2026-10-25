import React, { useState } from "react";
import type { Implication, ImplicationKind, IntakeJobSummary, Lesson, Standing } from "@shared/types";
import { useStore } from "../state/store";
import { api, IntakeRefusedError } from "../lib/api";
import { Badge } from "./ui";

const KIND_LABEL: Record<ImplicationKind, string> = { component: "Components", stage: "Stages", skill: "Skills", foundation: "Foundations", gap: "Ideas (gaps)" };
const KINDS: ImplicationKind[] = ["component", "stage", "skill", "foundation", "gap"];

/** A lesson's implications grouped by kind; each target links to where it lives in Reins. */
export function ImplicationsByKind({ lesson }: { lesson: Lesson }) {
  const navigate = useStore((s) => s.navigate);
  const components = useStore((s) => s.components);
  const items = (lesson.items ?? []).filter((i) => !i.implicit);
  const target = (i: Implication) => {
    if (!i.target) return null;
    const label = i.kind === "component" ? (components.find((c) => c.id === i.target)?.label ?? i.target) : i.target;
    // Where each kind lives on Harness: components and foundations have cards (#component-<id>),
    // skills have a row in the installed skills list (#skill-<name>), and a stage's lessons
    // reach its prompt through the "Lessons for this stage" component (#component-stageLessons).
    const go = () => {
      const t = i.target!;
      if (i.kind === "skill") navigate({ section: "harness", skill: t, component: null });
      else if (i.kind === "stage") navigate({ section: "harness", component: "stageLessons", skill: null });
      else navigate({ section: "harness", component: t, skill: null });
    };
    const title =
      i.kind === "stage"
        ? `Goes into the ${i.target} phase's first message via "Lessons for this stage"; open that component in Harness`
        : i.kind === "skill"
          ? `Open the ${i.target} skill in Harness › Skills`
          : `Open ${i.kind} ${i.target} in Harness`;
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
export function StandingControl({ lesson }: { lesson: Lesson }) {
  const refreshLessons = useStore((s) => s.refreshLessons);
  const [err, setErr] = useState<string | null>(null);
  if (lesson.source !== "user") return <Badge title="Shipped with Reins">bundled</Badge>;
  const set = async (standing: "reviewed" | "unreviewed") => {
    setErr(null);
    try {
      await api.setStanding(lesson.slug, standing);
      await refreshLessons();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <label className="muted" htmlFor={`standing-${lesson.slug}`}>
        standing
      </label>
      <select id={`standing-${lesson.slug}`} className="input py-0 text-[11.5px]" value={lesson.standing} onChange={(e) => set(e.target.value as "reviewed" | "unreviewed")}>
        <option value="unreviewed">unreviewed</option>
        <option value="reviewed">reviewed</option>
      </select>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </span>
  );
}

/** Start a lesson intake job from a URL or pasted text; its events open on the Stage like a run. */
/** `inline`: shown already open, e.g. inside the Lessons "Add a lesson" card. */
export function IntakeForm({ inline = false }: { inline?: boolean } = {}) {
  const selectRun = useStore((s) => s.selectRun);
  const refreshIntake = useStore((s) => s.refreshIntake);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<IntakeRefusedError["duplicate"]>(null);
  const start = async () => {
    setBusy(true);
    setErr(null);
    setDup(null);
    try {
      const r = await api.startIntake(url.trim() ? { url: url.trim() } : { text });
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
      <summary className="cursor-pointer font-semibold">Add a lesson from a source…</summary>
      <p className="muted mt-1.5">A librarian distils the source into a lesson with typed implications, each quoting the source. You review the draft before it lands in your library.</p>
      <input className="input w-full mt-2" placeholder="https://… (the source URL)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Source URL" />
      <div className="muted text-[11.5px] my-1">or paste the text</div>
      <textarea className="input w-full h-24" value={text} onChange={(e) => setText(e.target.value)} aria-label="Source text" disabled={!!url.trim()} />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button className="btn btn-primary" disabled={busy || (!url.trim() && !text.trim())} onClick={start}>
          {busy ? "Starting…" : "Start intake"}
        </button>
        {err && (
          <span className="text-red-600 text-[12px]" role="alert" data-intake-error>
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
              <span className="mono flex-1 min-w-0 truncate" title={j.url ?? "pasted text"}>
                {j.slug}
              </span>
              <Badge tone={st.tone} title={j.reason}>
                {st.label}
              </Badge>
              <span className="faint text-[10.5px]">{(j.updatedAt ?? j.createdAt).slice(0, 16).replace("T", " ")}</span>
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
