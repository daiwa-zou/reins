import React, { useEffect, useState } from "react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { Badge } from "../components/ui";
import { api } from "../lib/api";
import type { ComponentId, EngineId, HarnessComponent, Preset, RunConfig, SkillInfo } from "@shared/types";
import { adaptPreset, generatedPresets, presetCompatibility } from "@shared/presets";
import { defaultRunConfig } from "@shared/components";
import { ideas, linkCatalogue } from "@shared/implications";
import { applyPreset, BUILT_IN_PRESETS, checkRunConfig, diffFromDefaults, ENGINE_LABEL } from "@shared/config";

export const GROUP_LABEL: Record<HarnessComponent["group"], string> = { roles: "Roles", memory: "Memory across sessions", context: "Context window", tools: "Tools", safety: "Safety" };

/**
 * What each harness component does, what changes when it is off, which
 * engines honour it and what it depends on. With a run selected this is that
 * run's effective configuration (preset, diff from defaults, checker warnings)
 * and you can start a new run with one component flipped. With no run it shows
 * the defaults and the presets you can start from; there are no switches here,
 * because switches live in New run.
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
  const presets = useStore((s) => s.presets);
  const availableEngine = useStore((s) => s.availableEngine);
  const cfg = model.config;
  const on = cfg?.components;
  // Foundation (and component) lesson lists come from the implications that target them.
  const catalogue = React.useMemo(() => linkCatalogue(lessons), [lessons]);

  // Model-change nudge: compare the selected run's model to the most recent completed run before it.
  const previous = cfg ? runs.filter((r) => r.id !== cfg.id && r.status === "completed" && Date.parse(r.createdAt) < Date.parse(cfg.createdAt))[0] : undefined;
  const modelChanged = previous && cfg && previous.model !== cfg.roles.builder.model;

  // Only reachable with a run selected: flip one component of that run's config.
  const launchWithout = (run: RunConfig, id: ComponentId) => {
    openModal("newRun", { ...run, id: undefined, createdAt: undefined, engine: run.engine === "replay" ? availableEngine() : run.engine, components: { ...run.components, [id]: !run.components[id] }, __openHarness: true, title: `${run.title} (${run.components[id] ? "without" : "with"} ${components.find((c) => c.id === id)?.label ?? id})` } as any);
  };
  // Which engine a preset can start on: the usual engine if it fits, else the other one if it is available.
  const engineFor = (p: Preset): { engine: EngineId | null; reason?: string } => {
    const first = availableEngine();
    const order: EngineId[] = [first, first === "anthropic" ? "claude-code" : "anthropic"];
    const ready = (e: EngineId) => (e === "anthropic" ? !!info?.hasApiKey : !!info?.hasClaudeCode);
    const fits = order.filter((e) => presetCompatibility(p, e).ok);
    const usable = fits.find(ready) ?? (!order.some(ready) ? fits[0] : undefined);
    if (usable) return { engine: usable };
    const why = presetCompatibility(p, first).reasons[0] ?? "";
    return { engine: null, reason: fits.length ? `${why} ${ENGINE_LABEL[fits[0]]} is not available on this machine (${fits[0] === "anthropic" ? "add an API key in Settings" : "install the claude CLI"}).` : why };
  };
  const startWithPreset = (p: Preset) => {
    const { engine } = engineFor(p);
    if (!engine) return;
    const base = defaultRunConfig({ task: "", workspace: info?.defaultWorkspace ?? "", engine });
    openModal("newRun", { ...applyPreset(base, adaptPreset(p, engine)), id: undefined, createdAt: undefined, title: "", __openHarness: true } as any);
  };

  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => document.getElementById(`component-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    return () => clearTimeout(t);
  }, [focus]);

  const groups = [...new Set(components.map((c) => c.group))];
  const runEngine = cfg && cfg.engine !== "replay" ? cfg.engine : null;
  const presetList = presets.length ? presets : [...BUILT_IN_PRESETS, ...generatedPresets([])].map((p) => ({ ...p, isDefault: false }));

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="card p-4">
          <div className="text-[16px] font-semibold tracking-tight">Every component is an assumption about the model.</div>
          <p className="muted mt-1 leading-relaxed text-[12.5px]">
            Scaffolding that was load-bearing for one model is dead weight for the next. Remove pieces one at a time and watch what breaks; removing several at once hides which ones mattered.{" "}
            {cfg ? (
              <>
                Below is the effective configuration of <b>{cfg.title}</b>; use <i>run with/without →</i> on a card to try it with one component flipped.
              </>
            ) : (
              <>No run is selected, so the cards show the defaults. Switches live in New run; start from a preset below.</>
            )}
          </p>
          {modelChanged && (
            <div className="mt-3 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
              <b>Model changed</b> since your last completed run ({previous.model} → {cfg!.roles.builder.model}). This is the moment to re-examine the harness: try the same task with one component off.
            </div>
          )}
        </div>

        {cfg ? <EffectiveConfig cfg={cfg} /> : null}

        <div className="card p-4">
          <div className="flex items-center gap-2">
            <div className="font-semibold flex-1">Presets</div>
            <a className="text-small underline muted" href="/api/docs/configuring.md" target="_blank" rel="noreferrer">
              docs/configuring.md
            </a>
          </div>
          <div className="grid md:grid-cols-2 gap-2 mt-2">
            {presetList.map((p) => {
              const n = diffFromDefaults(applyPreset(defaultRunConfig({ task: "", workspace: "" }), p)).length;
              return (
                <div key={p.name} className="rounded-lg border line p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{p.name}</span>
                    {p.generated ? <Badge tone="accent">from lessons</Badge> : p.builtIn ? <Badge>built-in</Badge> : <Badge tone="accent">yours</Badge>}
                    {p.isDefault && <Badge tone="ok">your default</Badge>}
                    <span className="flex-1" />
                    <span className="faint text-[11px]">{n ? `${n} change${n === 1 ? "" : "s"} from defaults` : "the defaults"}</span>
                  </div>
                  {p.description && <div className="muted text-small leading-snug">{p.description}</div>}
                  <div className="faint text-[11px]">
                    {(["anthropic", "claude-code"] as const)
                      .map((e) => {
                        const c = presetCompatibility(p, e);
                        return `${ENGINE_LABEL[e]}: ${c.adaptive ? `adapted (${c.dropped.length} off)` : c.ok ? "yes" : "no"}`;
                      })
                      .join(" · ")}
                  </div>
                  {p.basis && p.basis.length > 0 && (
                    <div className="text-[11.5px] leading-snug" data-preset-basis>
                      <span className="font-semibold">Built from {p.basis.length} lesson{p.basis.length === 1 ? "" : "s"}:</span>{" "}
                      {p.basis.map((b, i) => (
                        <span key={b.slug}>
                          {i > 0 && ", "}
                          <button type="button" className="underline" onClick={() => setLessonFilter(b.slug)} title={b.effect}>
                            {b.title}
                          </button>
                          <span className="muted"> ({b.effect})</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {(() => {
                    const fit = engineFor(p);
                    return (
                      <>
                        <button className="btn btn-sm self-start mt-1" onClick={() => startWithPreset(p)} disabled={!fit.engine} title={fit.reason ?? (fit.engine ? `Opens New run on ${ENGINE_LABEL[fit.engine]}` : undefined)}>
                          Start a run with {p.name} →{fit.engine && fit.engine !== availableEngine() ? ` (on ${ENGINE_LABEL[fit.engine]})` : ""}
                        </button>
                        {!fit.engine && fit.reason && <div className="faint text-[11px]">{fit.reason}</div>}
                      </>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        {groups.map((g) => (
          <div key={g}>
            <div className="section-label mb-2">{GROUP_LABEL[g]}</div>
            <div className="grid md:grid-cols-2 gap-2">
              {components
                .filter((c) => c.group === g)
                .map((c) => {
                  const enabled = on ? on[c.id] : c.defaultOn;
                  const ignored = enabled && runEngine && !c.engines.includes(runEngine);
                  const unmet = enabled && on ? (c.requires ?? []).filter((r) => !on[r.id]) : [];
                  return (
                    <div key={c.id} id={`component-${c.id}`} className={`card p-3 flex flex-col gap-1.5 ${enabled ? "" : "opacity-80"}`} style={focus === c.id ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                      <div className="flex items-center gap-2">
                        <div className="font-semibold flex-1">{c.label}</div>
                        {cfg ? <Badge tone={enabled ? "ok" : "neutral"}>{enabled ? "on" : "off"}</Badge> : <Badge tone="neutral">{c.defaultOn ? "on by default" : "off by default"}</Badge>}
                      </div>
                      <div className="text-[12.5px] leading-relaxed">{c.short}</div>
                      <div className="text-[12px] muted leading-relaxed">
                        <span className="faint">when off:</span> {c.whenOff}
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
                        {ignored && <Badge tone="warn">ignored on this run's engine</Badge>}
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
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate({ section: "lessons", component: c.id, lesson: null })} title="Open the Lessons view filtered to this component">
                          lessons →
                        </button>
                        {cfg && (
                          <button className="btn btn-ghost btn-sm" onClick={() => launchWithout(cfg, c.id)} title="Start a new run with this component flipped">
                            run {enabled ? "without" : "with"} →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}

        <div>
          <div className="section-label mb-2">Foundations (not switches, still from the lessons)</div>
          <div className="grid md:grid-cols-2 gap-2">
            {catalogue.foundations.map((f) => (
              <div key={f.id} id={`component-${f.id}`} className="card p-3 flex flex-col gap-1" style={focus === f.id ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
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
        </div>

        <IdeasList lessons={lessons} onOpen={setLessonFilter} />

        <SkillsList workspace={cfg && cfg.engine !== "replay" ? cfg.workspace : info?.defaultWorkspace} focus={focusSkill} />
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
  // A lesson's skill link focuses the row once the list has loaded.
  useEffect(() => {
    if (!focus || !skills) return;
    const t = setTimeout(() => document.getElementById(`skill-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    return () => clearTimeout(t);
  }, [focus, skills]);
  return (
    <div className="card p-4">
      <div className="font-semibold">Skills</div>
      <p className="muted text-small mt-0.5">
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
    </div>
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
  return (
    <div data-ideas>
      <div className="section-label mb-1">Ideas · {all.length}</div>
      <div className="muted text-[12px] mb-2">Claims from the lessons that no switch or stage implements yet (gaps), and implications still unreviewed. Review a user lesson in Lessons to promote it.</div>
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
    </div>
  );
}
