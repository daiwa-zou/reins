import React, { useMemo, useState } from "react";
import type { ImplicationKind } from "@shared/types";
import { domainEffects, slugifyDomainId, validateUserDomain } from "@shared/domains";
import { presetDomains } from "@shared/presets";
import { PHASES } from "@shared/lessons";
import { COMPONENTS } from "@shared/components";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { Badge, Modal } from "./ui";
import { draftFor, filterImplications, pickable } from "../state/domainBuilder";

const KIND_LABEL: Record<ImplicationKind, string> = { component: "component", stage: "stage", skill: "skill", foundation: "foundation", gap: "idea", effort: "effort" };
const KINDS: ImplicationKind[] = ["stage", "component", "foundation", "skill", "gap", "effort"];
const label = (id: string) => COMPONENTS.find((c) => c.id === id)?.label ?? id;

/**
 * Build a domain from the library: pick implications, name the set, see what
 * it will do to a run, save. Editing an existing user domain starts from it.
 */
export function DomainBuilder() {
  const lessons = useStore((s) => s.lessons);
  const userDomains = useStore((s) => s.userDomains);
  const seed = useStore((s) => s.domainDraft);
  const openModal = useStore((s) => s.openModal);
  const refreshDomains = useStore((s) => s.refreshDomains);
  const refreshPresets = useStore((s) => s.refreshPresets);
  const toastMsg = useStore((s) => s.toastMsg);
  const setLessonFilter = useStore((s) => s.setLessonFilter);

  const editing = seed?.domain ?? null;
  const [draft, setDraft] = useState(() => draftFor(editing, seed?.lesson ?? null));
  const [idTouched, setIdTouched] = useState(!!editing);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ImplicationKind | null>(null);
  const [lessonFilter, setLesson] = useState<string | null>(seed?.lesson?.slug ?? null);
  const [pickedOnly, setPickedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => pickable(lessons), [lessons]);
  const picked = useMemo(() => new Set(draft.implications), [draft.implications]);
  const shown = filterImplications(all, { q, kind, lesson: lessonFilter, picked, pickedOnly });
  const lessonsWithItems = useMemo(() => [...new Set(all.map((i) => i.lesson))].map((slug) => ({ slug, title: lessons.find((l) => l.slug === slug)?.title ?? slug })), [all, lessons]);
  // Built-in and lesson-named domains are taken; a user domain's own id may be kept when editing.
  const reserved = useMemo(() => presetDomains(lessons).filter((d) => !userDomains.some((u) => u.id === d)), [lessons, userDomains]);
  const effectiveId = idTouched ? draft.id : slugifyDomainId(draft.label);
  const { problems } = validateUserDomain({ ...draft, id: effectiveId }, lessons, reserved);
  const fx = domainEffects({ ...draft, id: effectiveId || "draft" }, lessons);
  const stageCount = PHASES.reduce((n, p) => n + (fx.stages[p]?.length ?? 0), 0);

  const toggle = (id: string) => setDraft((d) => ({ ...d, implications: picked.has(id) ? d.implications.filter((x) => x !== id) : [...d.implications, id] }));
  const pickAllShown = () => setDraft((d) => ({ ...d, implications: [...new Set([...d.implications, ...shown.map((i) => i.id)])] }));
  const clear = () => setDraft((d) => ({ ...d, implications: [] }));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.saveDomain({ ...draft, id: effectiveId });
      await Promise.all([refreshDomains(), refreshPresets()]);
      toastMsg(`Domain “${saved.label}” saved; it is a chip in New run now.`);
      openModal(null);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.deleteDomain(editing.id);
      await Promise.all([refreshDomains(), refreshPresets()]);
      toastMsg(`Deleted the domain “${editing.label}”.`);
      openModal(null);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Edit the domain “${editing.label}”` : "Build a domain"} onClose={() => openModal(null)} width={880} dismissOnBackdrop={false}>
      <div className="flex flex-col gap-4" data-domain-builder>
        <p className="muted text-[12.5px] leading-relaxed -mt-1">
          A domain is a named set of implications from the lessons. Pick the ones that fit the kind of project you work on; a run that picks this domain gets its stage lines in each phase's first message, its component implications switched on, and the rest as guidance. Only the implications you pick apply, nothing else from their lessons.
        </p>

        <div className="grid md:grid-cols-[1fr_1fr_2fr] gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Label
            <input className="input" value={draft.label} placeholder="e.g. Our backend stack" maxLength={60} autoFocus onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-label="Domain label" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Id <span className="faint font-normal">(the chip and the run's domains)</span>
            <input className="input mono" value={effectiveId} disabled={!!editing} onChange={(e) => (setIdTouched(true), setDraft({ ...draft, id: e.target.value }))} aria-label="Domain id" placeholder="our-backend" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Description <span className="faint font-normal">(shown on the chip and the Harness page)</span>
            <input className="input" value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="Domain description" placeholder="What kind of work this is for" />
          </label>
        </div>

        <div className="grid md:grid-cols-[3fr_2fr] gap-4 min-h-0">
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <input className="input flex-1 min-w-[160px]" placeholder="Search claims, targets, lessons…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search implications" />
              <select className="input" style={{ width: 150 }} value={lessonFilter ?? ""} onChange={(e) => setLesson(e.target.value || null)} aria-label="Filter by lesson">
                <option value="">All lessons</option>
                {lessonsWithItems.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.title.slice(0, 48)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[11.5px]">
              <button type="button" className={`badge ${kind === null ? "badge-accent" : "badge-neutral"}`} onClick={() => setKind(null)}>
                all kinds
              </button>
              {KINDS.map((k) => (
                <button key={k} type="button" className={`badge ${kind === k ? "badge-accent" : "badge-neutral"}`} onClick={() => setKind(kind === k ? null : k)} data-kind-filter={k}>
                  {KIND_LABEL[k]}
                </button>
              ))}
              <span className="flex-1" />
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={pickedOnly} onChange={(e) => setPickedOnly(e.target.checked)} /> picked only
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={pickAllShown} disabled={!shown.length}>
                Pick all shown ({shown.length})
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!picked.size}>
                Clear
              </button>
            </div>
            <ul className="flex flex-col gap-1 overflow-auto rounded-lg border line p-2" style={{ maxHeight: 380 }} data-pick-list>
              {shown.length === 0 && <li className="faint text-[12px] p-2">Nothing matches.</li>}
              {shown.map((i) => (
                <li key={i.id} className={`rounded-md px-2 py-1.5 text-[12.5px] leading-snug flex gap-2 items-start ${picked.has(i.id) ? "sunk" : "hover:bg-[var(--bg-sunk)]"}`}>
                  <input type="checkbox" className="mt-1" checked={picked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Pick ${i.id}`} data-pick={i.id} />
                  <div className="min-w-0 flex-1">
                    <span className={`badge ${i.kind === "component" ? "badge-accent" : "badge-neutral"} mr-1.5`}>
                      {KIND_LABEL[i.kind]}
                      {i.target ? `: ${i.kind === "component" ? label(i.target) : i.target}` : ""}
                    </span>
                    {i.claim}
                    <div className="faint text-[11px] mt-0.5">
                      <button type="button" className="underline" onClick={() => (openModal(null), setLessonFilter(i.lesson))} title="Open the lesson (closes the builder)">
                        {i.lessonTitle}
                      </button>
                      {i.domains.length > 0 && <span> · {i.domains.join(", ")}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2 text-[12.5px]" data-domain-preview>
            <div className="font-semibold">
              What “{draft.label || "this domain"}” does <span className="faint font-normal">· {picked.size} picked</span>
            </div>
            <div className="rounded-lg border line p-3 flex flex-col gap-2 leading-relaxed">
              <div>
                <span className="faint">Switches on: </span>
                {fx.enables.length ? fx.enables.map(label).join(", ") : <span className="faint">nothing</span>}
              </div>
              <div>
                <span className="faint">Stage lines: </span>
                {stageCount ? PHASES.filter((p) => fx.stages[p]?.length).map((p) => `${p} ${fx.stages[p]!.length}`).join(", ") : <span className="faint">none</span>}
              </div>
              <div>
                <span className="faint">Guidance lines: </span>
                {fx.guidance.length || <span className="faint">none</span>}
              </div>
              {fx.ignored.length > 0 && (
                <div className="text-[11.5px] muted">
                  <span className="faint">Picked but changes nothing: </span>
                  {fx.ignored.join("; ")}
                </div>
              )}
              <div className="text-[11.5px] muted">
                <span className="faint">From: </span>
                {fx.lessons.length ? fx.lessons.map((slug) => lessons.find((l) => l.slug === slug)?.title ?? slug).join("; ") : "no lesson yet"}
              </div>
            </div>
            {problems.length > 0 && (
              <ul className="text-[11.5px] text-[var(--warn)] flex flex-col gap-0.5" data-domain-problems>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editing && (
            <button className="btn btn-ghost text-[var(--bad)]" disabled={busy} onClick={remove} data-delete-domain>
              Delete domain
            </button>
          )}
          <span className="flex-1" />
          <button className="btn" onClick={() => openModal(null)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || problems.length > 0} onClick={save} data-save-domain title={problems.length ? problems[0] : undefined}>
            {editing ? "Save changes" : "Save domain"}
          </button>
          <Badge tone="neutral">{`then pick “${draft.label || effectiveId || "it"}” in New run`}</Badge>
        </div>
      </div>
    </Modal>
  );
}
