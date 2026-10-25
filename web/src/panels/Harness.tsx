import React, { useEffect, useState } from "react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { Badge } from "../components/ui";
import { api } from "../lib/api";
import type { ComponentId, HarnessComponent, RunConfig, SkillInfo } from "@shared/types";
import { domainPresets, generatedPresets, PROFILE_IDS, presetChip } from "@shared/presets";
import { ideas, lessonInDomain, linkCatalogue } from "@shared/implications";
import { BUILT_IN_PRESETS, checkRunConfig, diffFromDefaults, ENGINE_LABEL } from "@shared/config";
import { classifyPresets, startingPointFor } from "../state/startingPoint";

export const GROUP_LABEL: Record<HarnessComponent["group"], string> = { roles: "Roles", memory: "Memory across sessions", context: "Context window", tools: "Tools", safety: "Safety" };

/**
 * The harness, in the same words as New run: starting points (Profile,
 * Domains, Saved presets), then one compact card per component (expand for
 * what happens when it is off, what it assumes and which engines honour it),
 * then Foundations, Ideas and Skills, collapsed. With a run selected the cards
 * show that run's switches and offer "run with/without".
 */
export function HarnessPanel({ model }: { model: RunModel }) {
  const components = useStore((s) => s.components);
  const lessons = useStore((s) => s.lessons);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const navigate = useStore((s) => s.navigate);
  const focus = useStore((s) => s.component);
  const focusSkill = useStore((s) => s.skill);
  const openModal = useStore((s) => s.openModal);
  const runs = useStore((s) => s.runs);
  const info = useStore((s) => s.info);
  const availableEngine = useStore((s) => s.availableEngine);
  const cfg = model.config;
  const on = cfg?.components;
  // Foundation (and component) lesson lists come from the implications that target them.
  const catalogue = React.useMemo(() => linkCatalogue(lessons), [lessons]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const isFoundation = (id: string | null | undefined) => !!id && catalogue.foundations.some((f) => f.id === id);
  const [foundationsOpen, setFoundationsOpen] = useState(isFoundation(focus));

  // Model-change nudge: compare the selected run's model to the most recent completed run before it.
  const previous = cfg ? runs.filter((r) => r.id !== cfg.id && r.status === "completed" && Date.parse(r.createdAt) < Date.parse(cfg.createdAt))[0] : undefined;
  const modelChanged = previous && cfg && previous.model !== cfg.roles.builder.model;

  // Only reachable with a run selected: flip one component of that run's config.
  const launchWithout = (run: RunConfig, id: ComponentId) => {
    openModal("newRun", { ...run, id: undefined, createdAt: undefined, engine: run.engine === "replay" ? availableEngine() : run.engine, components: { ...run.components, [id]: !run.components[id] }, __openHarness: true, title: `${run.title} (${run.components[id] ? "without" : "with"} ${components.find((c) => c.id === id)?.label ?? id})` } as any);
  };

  // ?component= scrolls to the card, highlights it and expands it (a foundation opens its section first).
  useEffect(() => {
    if (!focus) return;
    setExpanded((s) => new Set([...s, focus]));
    if (isFoundation(focus)) setFoundationsOpen(true);
    const t = setTimeout(() => document.getElementById(`component-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, catalogue]);
  const toggleCard = (id: string) => setExpanded((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const groups = [...new Set(components.map((c) => c.group))];
  const runEngine = cfg && cfg.engine !== "replay" ? cfg.engine : null;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="card p-4">
          <div className="text-[16px] font-semibold tracking-tight">Every component is an assumption about the model.</div>
          <p className="muted mt-1 leading-relaxed text-[12.5px]" data-harness-intro>
            Pick a starting point below to open New run, where Customize switches single components on or off. Change one thing at a time and compare runs, so you can see which pieces still matter.
          </p>
          {cfg && (
            <div className="muted mt-1 text-[12px]">
              The cards show the switches of <b>{cfg.title}</b>; use <i>run with/without</i> on an expanded card to try one flipped.
            </div>
          )}
          {modelChanged && (
            <div className="mt-3 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
              <b>Model changed</b> since your last completed run ({previous.model} → {cfg!.roles.builder.model}). This is the moment to re-examine the harness: try the same task with one component off.
            </div>
          )}
        </div>

        {cfg ? <EffectiveConfig cfg={cfg} /> : null}

        <StartingPoints />

        {groups.map((g) => (
          <div key={g}>
            <div className="section-label mb-2">{GROUP_LABEL[g]}</div>
            <div className="grid md:grid-cols-2 gap-2 items-start">
              {components
                .filter((c) => c.group === g)
                .map((c) => {
                  const enabled = on ? on[c.id] : c.defaultOn;
                  const ignored = enabled && runEngine && !c.engines.includes(runEngine);
                  const unmet = enabled && on ? (c.requires ?? []).filter((r) => !on[r.id]) : [];
                  const open = expanded.has(c.id);
                  return (
                    <div key={c.id} id={`component-${c.id}`} className={`card p-3 flex flex-col gap-1.5 ${enabled ? "" : "opacity-80"}`} style={focus === c.id ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                      <button type="button" className="flex items-center gap-2 text-left" aria-expanded={open} aria-controls={`component-body-${c.id}`} onClick={() => toggleCard(c.id)}>
                        <span className="faint text-[11px] w-3">{open ? "▾" : "▸"}</span>
                        <span className="font-semibold flex-1">{c.label}</span>
                        {cfg ? <Badge tone={enabled ? "ok" : "neutral"}>{enabled ? "on" : "off"}</Badge> : <Badge tone="neutral">{c.defaultOn ? "on by default" : "off by default"}</Badge>}
                        {ignored && <Badge tone="warn">ignored here</Badge>}
                      </button>
                      <div className="text-[12.5px] leading-snug muted">{c.short}</div>
                      {open && (
                        <div id={`component-body-${c.id}`} className="flex flex-col gap-1.5 fade-in">
                          <div className="text-[12px] muted leading-relaxed">
                            <span className="faint">When off:</span> {c.whenOff}
                          </div>
                          <div className="text-[11.5px] muted leading-relaxed">
                            <span className="faint">assumes:</span> {c.assumption}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="faint">engines:</span>
                            {(["anthropic", "claude-code"] as const).map((e) => (
                              <Badge key={e} tone={c.engines.includes(e) ? "ok" : "neutral"} title={c.engines.includes(e) ? `Honoured on ${ENGINE_LABEL[e]}` : `Ignored on ${ENGINE_LABEL[e]}`}>
                                {c.engines.includes(e) ? "" : "not "}
                                {ENGINE_LABEL[e]}
                              </Badge>
                            ))}
                            {(c.requires ?? []).map((r) => (
                              <Badge key={r.id} tone={unmet.some((u) => u.id === r.id) ? "warn" : "neutral"} title={r.reason}>
                                needs {components.find((x) => x.id === r.id)?.label ?? r.id}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            {c.lessons.map((slug) => {
                              const l = lessons.find((x) => x.slug === slug);
                              return (
                                <button key={slug} className="badge badge-accent hover:brightness-95" onClick={() => setLessonFilter(slug)} title={l?.takeaway}>
                                  {l?.title.split(":")[0].slice(0, 40) ?? slug}
                                </button>
                              );
                            })}
                            <span className="flex-1" />
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ section: "lessons", component: c.id, lesson: null })} title="Open Lessons filtered to this component">
                              lessons →
                            </button>
                            {cfg && (
                              <button className="btn btn-ghost btn-sm" onClick={() => launchWithout(cfg, c.id)} title="Start a new run with this component flipped">
                                run {enabled ? "without" : "with"} →
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}

        <details className="card p-4" open={foundationsOpen} onToggle={(e) => setFoundationsOpen((e.target as HTMLDetailsElement).open)} data-foundations>
          <summary className="cursor-pointer font-semibold">
            Foundations · {catalogue.foundations.length} <span className="faint font-normal text-[12px]">practices that are not switches</span>
          </summary>
          {foundationsOpen && (
          <div className="grid md:grid-cols-2 gap-2 mt-2">
            {catalogue.foundations.map((f) => (
              <div key={f.id} id={`component-${f.id}`} className="rounded-lg border line p-3 flex flex-col gap-1" style={focus === f.id ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                <div className="font-semibold">{f.label}</div>
                <div className="text-[12.5px] leading-relaxed muted">{f.short}</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {f.lessons.map((slug) => {
                    const l = lessons.find((x) => x.slug === slug);
                    return (
                      <button key={slug} className="badge badge-neutral hover:brightness-95" onClick={() => setLessonFilter(slug)} title={l?.takeaway}>
                        {l?.title.split(":")[0].slice(0, 40) ?? slug}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          )}
        </details>

        <IdeasList lessons={lessons} onOpen={setLessonFilter} />

        <SkillsList workspace={cfg && cfg.engine !== "replay" ? cfg.workspace : info?.defaultWorkspace} focus={focusSkill} />
      </div>
    </div>
  );
}

/**
 * Starting points, in New run's words: 3 profiles, the domains (with the
 * lessons that shape each) and your saved presets. This is the one place to
 * manage saved presets and the New run default.
 */
function StartingPoints() {
  const lessons = useStore((s) => s.lessons);
  const storePresets = useStore((s) => s.presets);
  const defaultPreset = useStore((s) => s.defaultPreset);
  const refreshPresets = useStore((s) => s.refreshPresets);
  const openModal = useStore((s) => s.openModal);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const toastMsg = useStore((s) => s.toastMsg);
  const list = storePresets.length ? storePresets : [...BUILT_IN_PRESETS, ...generatedPresets([])];
  const { saved, domains: generated } = classifyPresets(list);
  const domains = domainPresets(lessons);
  const def = startingPointFor(defaultPreset, { saved: saved.map((p) => p.name), generated: generated.map((p) => ({ name: p.name, domain: p.domain })) });
  const isDefault = (key: string) => (def.kind === "saved" ? def.name === key : def.kind === "compose" ? def.presets.join("+") === key : false);

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
    <div className="card p-4 flex flex-col gap-3" data-starting-points>
      <div className="flex items-center gap-2">
        <div className="font-semibold flex-1">Starting points</div>
        <a className="text-small underline muted" href="/api/docs/configuring.md" target="_blank" rel="noreferrer">
          docs/configuring.md
        </a>
      </div>
      <div className="muted text-small -mt-2">A run starts from one profile plus any domains, or from one of your saved presets.</div>
      <div>
        <div className="section-label mb-1.5">Profiles · how careful the run is</div>
        <ul className="grid md:grid-cols-3 gap-2">
          {PROFILE_IDS.map((id) => {
            const p = BUILT_IN_PRESETS.find((x) => x.id === id)!;
            return <Item key={id} k={id} title={p.name} label={p.name} description={p.description} defaultName={p.name} onStart={() => openModal("newRun", { __compose: [id] } as any)} dataKey={{ "data-start-profile": id }} />;
          })}
        </ul>
      </div>
      <div>
        <div className="section-label mb-1.5">Domains · what kind of project (added to a profile)</div>
        <ul className="grid md:grid-cols-2 gap-2">
          {domains.map((d) => {
            const shaping = lessons.filter((l) => l.standing !== "unreviewed" && lessonInDomain(l, d.id!));
            const name = domainPresetName(d.id!);
            return (
              <Item key={d.id} k={`full+${d.id}`} title={presetChip(d.id!)} label={`Full · ${presetChip(d.id!)}`} description={d.description} defaultName={name} onStart={() => openModal("newRun", { __compose: ["full", d.id!] } as any)} dataKey={{ "data-start-domain": d.id! }}>
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

function EffectiveConfig({ cfg }: { cfg: RunConfig }) {
  const diff = diffFromDefaults(cfg);
  const warnings = checkRunConfig(cfg);
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="font-semibold flex-1">Effective configuration</div>
        {cfg.preset ? <Badge tone="accent">preset: {cfg.preset}</Badge> : <Badge>no preset recorded</Badge>}
      </div>
      <div>
        <div className="section-label mb-1">Changes from defaults · {diff.length}</div>
        {diff.length ? (
          <ul className="text-small flex flex-col gap-0.5">
            {diff.map((d) => (
              <li key={d.path} className="mono text-[11.5px]">
                {d.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted text-small">Same as the defaults.</div>
        )}
      </div>
      <div>
        <div className="section-label mb-1">Config check · {warnings.length}</div>
        {warnings.length ? (
          <ul className="text-small flex flex-col gap-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2 items-start">
                <Badge tone={w.level === "warn" ? "warn" : "neutral"}>{w.level}</Badge>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted text-small">No warnings: nothing in this config is ignored or contradictory.</div>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
        {(["planner", "builder", "evaluator", "classifier", "scout"] as const).map((r) => (
          <Row key={r} k={r} v={cfg.roles?.[r] ? `${cfg.roles[r].model} · effort ${cfg.roles[r].effort}` : "default"} />
        ))}
        <Row k="budget" v={`$${cfg.budgetUsd} · ${cfg.maxTurnsPerPhase} turns/phase · ${cfg.maxFixRounds} fix rounds`} />
        {cfg.context && <Row k="context" v={`compact ${cfg.context.compactAtTokens.toLocaleString()} · clear keep ${cfg.context.clearToolResultsAfterTurns} · reset ${cfg.context.resetAtTokens.toLocaleString()}`} />}
        {cfg.guardrail && <Row k="guardrail" v={`${cfg.guardrail.mode} · network ${cfg.guardrail.allowNetwork ? "on" : "off"}`} />}
        <Row k="pauses" v={Object.entries(cfg.pauses ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"} />
        <Row k="engine" v={cfg.engine} />
        <Row k="workspace" v={cfg.workspace} />
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
        Installed skills for <code className="mono">{workspace || "the server's default workspace"}</code>. Only names and descriptions go in the prompt; a role reads the body with read_skill. Workspace skills override yours, which
        override the bundled ones.
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="faint w-20 shrink-0">{k}</span>
      <span className="mono text-[11.5px] truncate" title={v}>
        {v}
      </span>
    </div>
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
        Ideas · {all.length} <span className="faint font-normal text-[12px]">claims no switch implements yet</span>
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
