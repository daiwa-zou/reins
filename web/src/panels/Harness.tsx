import React, { useEffect, useState } from "react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { Badge } from "../components/ui";
import { api } from "../lib/api";
import type { SkillInfo } from "@shared/types";
import { domainPresets, generatedPresets, presetChip } from "@shared/presets";
import { EFFORT_LEVELS, EFFORT_TABLE, SUPERVISION_LEVELS, SUPERVISION_TABLE } from "@shared/components";
import { ideas, lessonInDomain } from "@shared/implications";
import { classifyPresets, effortSummary, startingPointFor, supervisionSummary } from "../state/startingPoint";
import { tokens } from "../lib/format";

/**
 * The page you start runs from. A run is an Effort level (what runs), a
 * Supervision level (when you are asked) and any domains, or one of your saved
 * presets; each card says in plain words what it means and opens New run.
 * Components are never listed here: Effort sets them, and the per-component
 * table lives in docs/configuring.md. Skills and Ideas sit collapsed below.
 */
export function HarnessPanel({ model }: { model: RunModel }) {
  const lessons = useStore((s) => s.lessons);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const focusSkill = useStore((s) => s.skill);
  const info = useStore((s) => s.info);
  const cfg = model.config;
  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <StartingPoints />
        <SkillsList workspace={cfg && cfg.engine !== "replay" ? cfg.workspace : info?.defaultWorkspace} focus={focusSkill} />
        <IdeasList lessons={lessons} onOpen={setLessonFilter} />
      </div>
    </div>
  );
}

/**
 * Starting points, in New run's words: Effort, Supervision, the domains (with
 * the lessons that shape each) and your saved presets. This is the one place
 * to manage saved presets and the New run default.
 */
function StartingPoints() {
  const lessons = useStore((s) => s.lessons);
  const storePresets = useStore((s) => s.presets);
  const defaultPreset = useStore((s) => s.defaultPreset);
  const refreshPresets = useStore((s) => s.refreshPresets);
  const openModal = useStore((s) => s.openModal);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const toastMsg = useStore((s) => s.toastMsg);
  const userDomains = useStore((s) => s.userDomains);
  const openDomainBuilder = useStore((s) => s.openDomainBuilder);
  const list = storePresets.length ? storePresets : generatedPresets([]);
  const { saved, domains: generated } = classifyPresets(list);
  const domains = domainPresets(lessons, userDomains);
  const def = startingPointFor(defaultPreset, { saved: saved.map((p) => p.name), generated: generated.map((p) => ({ name: p.name, domain: p.domain })) });
  const isDefault = (key: string) => (def.kind === "saved" ? def.name === key : def.kind === "compose" ? ["full", ...def.domains].join("+") === key : false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await refreshPresets();
      toastMsg(ok);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    }
  };
  const setDefault = (name: string | null, label?: string) => act(() => api.setDefaultPreset(name), name ? `New run now starts from ${label ?? name}.` : "New run starts from Full again.");
  // The server stores the default by preset name; a domain's is its lesson preset's name (e.g. "Web app").
  const domainPresetName = (id: string) => generated.find((g) => g.domain === id)?.name;

  const Item = ({ k, title, description, onStart, children, defaultName, label, dataKey }: { k: string; title: string; description?: string; onStart: () => void; children?: React.ReactNode; defaultName?: string; label: string; dataKey: Record<string, string> }) => (
    <li className="rounded-lg border line p-3 flex flex-col gap-1" {...dataKey}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{title}</span>
        {isDefault(k) && <Badge tone="ok">your default</Badge>}
        <span className="flex-1" />
        {defaultName &&
          (isDefault(k) ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setDefault(null)} data-clear-default>
              Clear default
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setDefault(defaultName, label)} data-make-default>
              Make default
            </button>
          ))}
        <button className="btn btn-sm" onClick={onStart} data-start-run>
          Start a run
        </button>
      </div>
      {description && <div className="muted text-small leading-snug">{description}</div>}
      {children}
    </li>
  );

  return (
    <div className="card p-4 flex flex-col gap-4" data-starting-points>
      <div>
        <div className="flex items-center gap-2">
          <div className="text-[16px] font-semibold tracking-tight flex-1">Start a run</div>
          <a className="text-small underline muted" href="/api/docs/configuring.md" target="_blank" rel="noreferrer">
            docs/configuring.md
          </a>
        </div>
        <p className="muted text-[12.5px] leading-relaxed mt-1" data-harness-intro>
          A run is an <b>Effort</b> level (what the harness does), a <b>Supervision</b> level (when it asks you) and any <b>domains</b> (what kind of project), or one of your saved presets. Pick one to open New run with it filled in; everything else is set for you. Build your own domain from the lessons' implications with <i>Build a domain…</i>.
        </p>
      </div>

      <div>
        <div className="section-label mb-1.5">Effort · what runs</div>
        <ul className="grid md:grid-cols-4 gap-2">
          {EFFORT_LEVELS.map((id) => {
            const s = effortSummary(id);
            return (
              <li key={id} className="card p-2.5 flex flex-col gap-1.5" data-start-effort={id}>
                <div className="font-semibold">{EFFORT_TABLE[id].label}</div>
                <div className="muted text-[12px] leading-snug">{EFFORT_TABLE[id].meaning}</div>
                <div className="text-[11.5px] leading-snug flex-1">
                  <div>
                    <span className="faint">Stages: </span>
                    {s.stages.join(" → ")}
                  </div>
                  {s.extras.length > 0 && (
                    <div>
                      <span className="faint">Also: </span>
                      {s.extras.join(", ")}
                    </div>
                  )}
                  <div className="faint">
                    {s.fixRounds} fix round{s.fixRounds === 1 ? "" : "s"} · {s.turns} turns per phase · ${s.budgetUsd} on the direct API, {tokens(s.budgetTokens)} tokens on Claude Code
                  </div>
                </div>
                <button type="button" className="btn btn-sm self-start" onClick={() => openModal("newRun", { __compose: { effort: id } } as any)}>
                  Start a run →
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="section-label mb-1.5">Supervision · when it asks you</div>
        <ul className="grid md:grid-cols-3 gap-2">
          {SUPERVISION_LEVELS.map((id) => {
            const pauses = supervisionSummary(id);
            return (
              <li key={id} className="card p-2.5 flex flex-col gap-1.5" data-start-supervision={id}>
                <div className="font-semibold">{SUPERVISION_TABLE[id].label}</div>
                <div className="muted text-[12px] leading-snug">{SUPERVISION_TABLE[id].meaning}</div>
                <div className="text-[11.5px] leading-snug flex-1">
                  <span className="faint">Pauses: </span>
                  {pauses.length ? pauses.join(", ") : "none"}
                </div>
                <button type="button" className="btn btn-sm self-start" onClick={() => openModal("newRun", { __compose: { supervision: id } } as any)}>
                  Start a run →
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="section-label flex-1">Domains · what kind of project (layered over Effort and Supervision)</div>
          <button type="button" className="btn btn-sm" onClick={() => openDomainBuilder()} data-build-domain>
            Build a domain…
          </button>
        </div>
        <ul className="grid md:grid-cols-2 gap-2">
          {domains.map((d) => {
            const mine = userDomains.find((u) => u.id === d.id);
            const shaping = mine ? [] : lessons.filter((l) => l.standing !== "unreviewed" && lessonInDomain(l, d.id!));
            const name = domainPresetName(d.id!);
            return (
              <Item key={d.id} k={`full+${d.id}`} title={mine ? d.name : presetChip(d.id!)} label={`Medium · Check in · ${presetChip(d.id!)}`} description={d.description} defaultName={name} onStart={() => openModal("newRun", { __compose: { domains: [d.id!] } } as any)} dataKey={{ "data-start-domain": d.id! }}>
                {mine && (
                  <div className="text-[11.5px] leading-snug flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">yours</Badge>
                    <span className="faint">
                      Built from {mine.implications.length} implication{mine.implications.length === 1 ? "" : "s"}
                      {d.basis?.length ? ` in ${d.basis.length} lesson${d.basis.length === 1 ? "" : "s"}` : ""}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDomainBuilder({ domain: mine })} data-edit-domain={mine.id}>
                      Edit
                    </button>
                  </div>
                )}
                {shaping.length > 0 && (
                  <div className="text-[11.5px] leading-snug">
                    <span className="faint">Shaped by: </span>
                    {shaping.map((l, i) => (
                      <span key={l.slug}>
                        {i > 0 && ", "}
                        <button type="button" className="underline" onClick={() => setLessonFilter(l.slug)} title={l.takeaway}>
                          {l.title}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Item>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="section-label mb-1.5">Your saved presets · {saved.length}</div>
        {saved.length === 0 ? (
          <div className="muted text-small">None yet. In New run, open Customize and use “Save as preset…” to keep a setup you like.</div>
        ) : (
          <ul className="grid md:grid-cols-2 gap-2">
            {saved.map((p) => (
              <Item key={p.name} k={p.name} title={p.name} label={`“${p.name}”`} description={p.description} defaultName={p.name} onStart={() => openModal("newRun", { __saved: p.name } as any)} dataKey={{ "data-saved-item": p.name }}>
                <button className="btn btn-ghost btn-sm self-start text-[var(--bad)]" onClick={() => act(() => api.deletePreset(p.name), `Deleted “${p.name}”.`)} data-delete-preset>
                  Delete
                </button>
              </Item>
            ))}
          </ul>
        )}
      </div>
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
  // Collapsed by default; a lesson's skill link (?skill=) opens it and focuses the row once the list has loaded.
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
    <details className="card p-4" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-skills>
      <summary className="cursor-pointer font-semibold">
        Skills · {skills ? skills.length : 0} <span className="faint font-normal text-[12px]">{skills ? "installed for this workspace" : "loading"}</span>
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
                <li
                  key={`${s.source}-${s.name}`}
                  // The first row with a name owns the anchor (a workspace skill overrides a bundled one of the same name).
                  id={skills.findIndex((x) => x.name === s.name) === i ? `skill-${s.name}` : undefined}
                  className="flex gap-2 items-start text-small rounded"
                  style={focus === s.name ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}
                >
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

/**
 * Ideas: gap implications and unreviewed ones, with their lesson and quote.
 * Unreviewed implications only ever appear here, never in stage prompts or presets.
 */
function IdeasList({ lessons, onOpen }: { lessons: import("@shared/types").Lesson[]; onOpen: (slug: string) => void }) {
  const all = React.useMemo(() => ideas(lessons), [lessons]);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? all : all.slice(0, 12);
  const [open, setOpen] = useState(false);
  return (
    <details className="card p-4" data-ideas open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold">
        Ideas · {all.length} <span className="faint font-normal text-[12px]">claims from the lessons that nothing implements yet</span>
      </summary>
      {open && (
        <>
          <div className="muted text-[12px] my-2">Claims from the lessons that no switch or stage implements yet (gaps), and implications still unreviewed. Review a user lesson in Lessons to promote it.</div>
          {all.length === 0 ? (
            <div className="faint text-[12px]">No ideas: every implication has a target and a standing.</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((i, n) => (
                <li key={`${i.lesson}-${n}`} className="card p-2.5 text-[12.5px] flex flex-col gap-1">
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
