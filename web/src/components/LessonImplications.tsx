import React, { useState } from "react";
import type { Implication, ImplicationKind, Lesson, Standing } from "@shared/types";
import { useStore } from "../state/store";
import { api } from "../lib/api";
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
export function IntakeForm() {
  const selectRun = useStore((s) => s.selectRun);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.startIntake(url.trim() ? { url: url.trim() } : { text });
      selectRun(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="card p-3 text-[12.5px]">
      <summary className="cursor-pointer font-semibold">Add a lesson from a source…</summary>
      <p className="muted mt-1.5">A librarian distils the source into a lesson with typed implications, each quoting the source. You review the draft before it lands in your library.</p>
      <input className="input w-full mt-2" placeholder="https://… (the source URL)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Source URL" />
      <div className="muted text-[11.5px] my-1">or paste the text</div>
      <textarea className="input w-full h-24" value={text} onChange={(e) => setText(e.target.value)} aria-label="Source text" disabled={!!url.trim()} />
      <div className="flex items-center gap-2 mt-2">
        <button className="btn btn-primary" disabled={busy || (!url.trim() && !text.trim())} onClick={start}>
          {busy ? "Starting…" : "Start intake"}
        </button>
        {err && <span className="text-red-600 text-[12px]">{err}</span>}
      </div>
    </details>
  );
}
