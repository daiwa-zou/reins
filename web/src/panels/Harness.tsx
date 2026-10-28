import React, { useEffect, useState } from "react";
import { Pencil, Play, Plus, Trash2 } from "lucide-react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { Badge, Kbd } from "../components/ui";
import { api } from "../lib/api";
import type { SkillInfo } from "@shared/types";
import { domainPresets, presetChip } from "@shared/presets";
import { DEFAULT_COMPOSITION, EFFORT_LEVELS, EFFORT_TABLE, SUPERVISION_LEVELS, SUPERVISION_TABLE } from "@shared/components";
import { ideas } from "@shared/implications";
import { effortSummary, presetOptions, startingPointFor, supervisionSummary } from "../state/startingPoint";
import { tokens } from "../lib/format";

/**
 * The page you start runs from: one card per Effort level and per Supervision
 * level (the card is the button), the domains as chips with a + to build one,
 * your saved presets, and the skills and ideas folded away. Components are
 * never listed here: Effort sets them.
 */
export function HarnessPanel({ model }: { model: RunModel }) {
  const lessons = useStore((s) => s.lessons);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const focusSkill = useStore((s) => s.skill);
  const info = useStore((s) => s.info);
  const openModal = useStore((s) => s.openModal);
  const cfg = model.config;
  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="flex items-center gap-3 px-6 py-3.5 border-b line shrink-0" style={{ background: "var(--bg-elev)" }}>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold m-0 leading-tight">Start a run</h1>
          <div className="muted text-small mt-0.5">Pick how hard the harness works and when it asks you, add the kind of project. Everything else is set for you.</div>
        </div>
        <button className="btn btn-primary" onClick={() => openModal("newRun")} title="Start a new run (n)">
          <Plus size={14} aria-hidden /> New run <Kbd>n</Kbd>
        </button>
      </header>
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-[1080px] mx-auto flex flex-col gap-6">
          <StartingPoints />
          <div className="flex flex-wrap gap-3">
            <SkillsList workspace={cfg && cfg.engine !== "replay" ? cfg.workspace : info?.defaultWorkspace} focus={focusSkill} />
            <IdeasList lessons={lessons} onOpen={setLessonFilter} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StartingPoints() {
  const lessons = useStore((s) => s.lessons);
  const storePresets = useStore((s) => s.presets);
  const defaultPreset = useStore((s) => s.defaultPreset);
  const refreshPresets = useStore((s) => s.refreshPresets);
  const openModal = useStore((s) => s.openModal);
  const toastMsg = useStore((s) => s.toastMsg);
  const userDomains = useStore((s) => s.userDomains);
  const openDomainBuilder = useStore((s) => s.openDomainBuilder);
  const { saved, options } = presetOptions(storePresets);
  const domains = domainPresets(lessons, userDomains);
  const def = startingPointFor(defaultPreset, options);
  const isDefaultPreset = (name: string) => def.kind === "saved" && def.name === name;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await refreshPresets();
      toastMsg(ok);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    }
  };
  const setDefault = (name: string | null, label?: string) => act(() => api.setDefaultPreset(name), name ? `New run now starts from ${label ?? name}.` : "New run starts from the defaults again.");

  return (
    <div className="flex flex-col gap-6" data-starting-points>
      <section aria-labelledby="effort-h" className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2">
          <h2 id="effort-h" className="section-label m-0">
            Effort · what runs
          </h2>
          <span className="faint text-small">one per run; click a card to start with it</span>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          {EFFORT_LEVELS.map((id) => {
            const s = effortSummary(id);
            const isDefault = id === DEFAULT_COMPOSITION.effort;
            return (
              <button key={id} type="button" className="card pick p-3.5 text-left flex flex-col gap-1.5" aria-pressed={isDefault} data-start-effort={id} onClick={() => openModal("newRun", { __compose: { effort: id } })} title={`Start a run at ${EFFORT_TABLE[id].label} effort`}>
                <span className="font-semibold text-[14px] flex items-center gap-2">
                  {EFFORT_TABLE[id].label}
                  {isDefault && <Badge tone="accent">default</Badge>}
                </span>
                <span className="muted text-small leading-snug">{EFFORT_TABLE[id].meaning}</span>
                <span className="text-small leading-snug mt-1">{s.stages.join(" → ")}</span>
                {s.extras.length > 0 && <span className="text-small leading-snug muted">Also: {s.extras.join(", ")}</span>}
                <span className="faint text-caption mt-auto pt-1">
                  {s.fixRounds} fix round{s.fixRounds === 1 ? "" : "s"} · {s.turns} turns per phase · ${s.budgetUsd} or {tokens(s.budgetTokens)} tokens
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="sup-h" className="flex flex-col gap-2.5">
        <h2 id="sup-h" className="section-label m-0">
          Supervision · when it asks you
        </h2>
        <div className="grid md:grid-cols-4 gap-3">
          {SUPERVISION_LEVELS.map((id) => {
            const pauses = supervisionSummary(id);
            const isDefault = id === DEFAULT_COMPOSITION.supervision;
            return (
              <button key={id} type="button" className="card pick p-3.5 text-left flex flex-col gap-1.5" aria-pressed={isDefault} data-start-supervision={id} onClick={() => openModal("newRun", { __compose: { supervision: id } })} title={`Start a run with ${SUPERVISION_TABLE[id].label}`}>
                <span className="font-semibold text-[14px] flex items-center gap-2">
                  {SUPERVISION_TABLE[id].label}
                  {isDefault && <Badge tone="accent">default</Badge>}
                </span>
                <span className="muted text-small leading-snug">{SUPERVISION_TABLE[id].meaning}</span>
                <span className="faint text-caption mt-auto pt-1">Pauses: {pauses.length ? pauses.join(", ") : "none"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="dom-h" className="flex flex-col gap-2.5">
        <h2 id="dom-h" className="section-label m-0">
          Domains · what kind of project
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {domains.map((d) => {
            const mine = userDomains.find((u) => u.id === d.id);
            return (
              <span key={d.id} className="inline-flex items-center">
                <button type="button" className="chip" onClick={() => openModal("newRun", { __compose: { domains: [d.id!] } })} title={`${d.description}\nStart a run with this domain`} data-start-domain={d.id}>
                  {mine ? d.name : presetChip(d.id!)}
                  {mine && <Badge tone="accent">yours</Badge>}
                </button>
                {mine && (
                  <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Edit the domain ${d.name}`} title="Edit this domain" onClick={() => openDomainBuilder({ domain: mine })} data-edit-domain={mine.id}>
                    <Pencil size={12} aria-hidden />
                  </button>
                )}
              </span>
            );
          })}
          <button type="button" className="chip chip-add" aria-label="Build a domain from the lessons' implications" title="Build a domain…" onClick={() => openDomainBuilder()} data-build-domain>
            <Plus size={14} aria-hidden />
          </button>
        </div>
        <div className="muted text-small leading-relaxed">
          {domains.map((d) => (
            <span key={d.id} className="mr-3">
              <b>{userDomains.some((u) => u.id === d.id) ? d.name : presetChip(d.id!)}:</b> {d.description}
              {d.basis?.length ? <span className="faint"> · {d.basis.length} lesson{d.basis.length === 1 ? "" : "s"}</span> : null}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="saved-h" className="flex flex-col gap-2.5">
        <h2 id="saved-h" className="section-label m-0">
          Your saved presets · {saved.length}
        </h2>
        {saved.length === 0 ? (
          <div className="muted text-small">None yet. In New run, open Customize and use “Save as preset” to keep a setup you like.</div>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {saved.map((p) => (
              <li key={p.name} className="card p-3 flex items-center gap-3" data-saved-item={p.name}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {p.name}
                    {isDefaultPreset(p.name) && <Badge tone="ok">your default</Badge>}
                  </div>
                  {p.description && <div className="muted text-small truncate">{p.description}</div>}
                </div>
                {isDefaultPreset(p.name) ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setDefault(null)} data-clear-default>
                    Clear default
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setDefault(p.name, `“${p.name}”`)} data-make-default>
                    Make default
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => openModal("newRun", { __saved: p.name })} data-start-run>
                  <Play size={12} aria-hidden /> Start a run
                </button>
                <button className="icon-btn" aria-label={`Delete the preset ${p.name}`} title="Delete this preset" onClick={() => act(() => api.deletePreset(p.name), `Deleted “${p.name}”.`)} data-delete-preset>
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SkillsList({ workspace, focus }: { workspace?: string; focus?: string | null }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    api
      .skills(workspace)
      .then((s) => live && setSkills(s))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [workspace]);
  const [open, setOpen] = useState(!!focus);
  useEffect(() => {
    if (focus) setOpen(true);
  }, [focus]);
  useEffect(() => {
    if (!focus || !skills) return;
    const t = setTimeout(() => document.getElementById(`skill-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    return () => clearTimeout(t);
  }, [focus, skills]);
  return (
    <details className="card p-4 flex-1 basis-[320px]" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-skills>
      <summary className="cursor-pointer font-semibold">
        Skills · {skills ? skills.length : 0} <span className="faint font-normal text-small">{skills ? "installed for this workspace" : "loading"}</span>
      </summary>
      {open && (
        <>
          <p className="muted text-small mt-1">
            Installed skills for <code className="mono">{workspace || "the server's default workspace"}</code>. Only names and descriptions go in the prompt; a role reads the body with read_skill. Workspace skills override yours, which override the bundled ones.
          </p>
          {error && <div className="text-[var(--bad)] text-small mt-2">Could not list skills: {error}</div>}
          {skills && !skills.length && <div className="muted text-small mt-2">No skills installed.</div>}
          {focus && skills && !skills.some((s) => s.name === focus) && <div className="text-small mt-2 muted">The skill “{focus}” a lesson names is not installed for this workspace.</div>}
          {skills && skills.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {skills.map((s, i) => (
                <li key={`${s.source}-${s.name}`} id={skills.findIndex((x) => x.name === s.name) === i ? `skill-${s.name}` : undefined} className="flex gap-2 items-start text-small rounded" style={focus === s.name ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                  <Badge tone={s.source === "bundled" ? "neutral" : "accent"}>{s.source}</Badge>
                  <div className="min-w-0">
                    <div className="font-medium">{s.name}</div>
                    <div className="muted leading-snug">{s.description || <i>no description: the agents cannot tell when to use it</i>}</div>
                    <div className="faint mono text-[11px] truncate" title={s.dir}>
                      {s.dir}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  );
}

function IdeasList({ lessons, onOpen }: { lessons: import("@shared/types").Lesson[]; onOpen: (slug: string) => void }) {
  const all = React.useMemo(() => ideas(lessons), [lessons]);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? all : all.slice(0, 12);
  const [open, setOpen] = useState(false);
  return (
    <details className="card p-4 flex-1 basis-[320px]" data-ideas open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold">
        Ideas · {all.length} <span className="faint font-normal text-small">claims from the lessons that nothing implements yet</span>
      </summary>
      {open && (
        <>
          <div className="muted text-small my-2">Claims from the lessons that no switch or stage implements yet (gaps), and implications still unreviewed. Review a user lesson in Lessons to promote it.</div>
          {all.length === 0 ? (
            <div className="faint text-small">No ideas: every implication has a target and a standing.</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((i, n) => (
                <li key={`${i.lesson}-${n}`} className="card p-2.5 text-small flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={i.kind === "gap" ? "neutral" : "warn"}>{i.kind === "gap" ? "gap" : `${i.kind}:${i.target ?? ""} · ${i.standing}`}</Badge>
                    <span className="flex-1 min-w-0">{i.claim}</span>
                    <button className="badge badge-neutral hover:brightness-95" onClick={() => onOpen(i.lesson)} title={`Open ${i.lessonTitle} in Lessons`} data-idea-lesson={i.lesson}>
                      {i.lessonTitle.split(":")[0].slice(0, 40)}
                    </button>
                  </div>
                  {i.quote && <blockquote className="muted text-[11.5px] border-l-2 line pl-2 italic">“{i.quote}”</blockquote>}
                </li>
              ))}
            </ul>
          )}
          {all.length > 12 && (
            <button className="btn btn-ghost btn-sm mt-1" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${all.length}`}
            </button>
          )}
        </>
      )}
    </details>
  );
}
