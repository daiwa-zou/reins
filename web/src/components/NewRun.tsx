import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Switch, Badge } from "./ui";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { defaultRunConfig, MODELS } from "@shared/components";
import { alwaysTierOffs } from "@shared/config";
import { applyPreset, checkRunConfig, diffFromDefaults, ENGINE_LABEL, presetFromConfig } from "@shared/config";
import { money, tokens } from "../lib/format";
import type { ComponentId, Composition, EffortLevel, EngineId, HarnessComponent, Preset, PresetBasis, RunConfig } from "@shared/types";
import { adaptPreset, composeRun, compositionOf, generatedPresets, presetCompatibility } from "@shared/presets";
import { ComposePicker } from "./ComposePicker";
import { compositionError } from "../state/runChip";
import { classifyPresets, describeStart, startingPointFor, type StartingPoint } from "../state/startingPoint";

const GROUP_LABEL: Record<HarnessComponent["group"], string> = { roles: "Roles", memory: "Memory across sessions", context: "Context window", tools: "Tools", safety: "Safety" };

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Prefill extras New run understands besides a RunConfig (run again, Harness, Lessons). */
export interface NewRunExtras {
  /** Start from this composition, composed fresh (e.g. "Start a run with Web"). */
  __compose?: Partial<Composition>;
  /** Start from this saved preset. */
  __saved?: string;
  /** Open Customize on the components. */
  __openHarness?: boolean;
  __notice?: string;
}

/**
 * New run, in two depths. Always visible: the task, the folder, the engine,
 * Start from (Effort + Supervision + Domains, or a Saved preset), the budget and Start.
 * Everything else sits in one Customize disclosure with a change count.
 */
export function NewRun() {
  const openModal = useStore((s) => s.openModal);
  const prefill = useStore((s) => s.newRunPrefill) as (Partial<RunConfig> & NewRunExtras) | undefined;
  const info = useStore((s) => s.info);
  const components = useStore((s) => s.components);
  const selectRun = useStore((s) => s.selectRun);
  const toastMsg = useStore((s) => s.toastMsg);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const lessons = useStore((s) => s.lessons);
  const userDomains = useStore((s) => s.userDomains);
  const openDomainBuilder = useStore((s) => s.openDomainBuilder);

  const draft = useStore((s) => s.newRunDraft);
  const setNewRunDraft = useStore((s) => s.setNewRunDraft);
  const storePresets = useStore((s) => s.presets);
  const defaultPreset = useStore((s) => s.defaultPreset);
  const defaultComposition = useStore((s) => s.defaultComposition);
  const refreshPresets = useStore((s) => s.refreshPresets);
  const presets: Preset[] = storePresets.length ? storePresets : generatedPresets([]);
  // Effort, supervision and domains are picked in ComposePicker; the Saved preset select lists only the user's own.
  const classified = classifyPresets(presets);
  const saved = classified.saved;
  const spOpts = { saved: saved.map((p) => p.name), generated: classified.domains.map((p) => ({ name: p.name, domain: p.domain })) };
  const preferredEngine: EngineId = info?.hasApiKey ? "anthropic" : info?.hasClaudeCode ? "claude-code" : "anthropic";
  const fresh = (keep: Partial<RunConfig> = {}) =>
    defaultRunConfig({ task: keep.task ?? "", workspace: keep.workspace ?? info?.defaultWorkspace ?? "", engine: (keep.engine as RunConfig["engine"]) ?? preferredEngine, title: keep.title, ...(typeof keep.budgetUsd === "number" ? { budgetUsd: keep.budgetUsd } : {}) });
  const liveEngineOf = (c: Partial<RunConfig>): EngineId => (c.engine && c.engine !== "replay" ? c.engine : preferredEngine);

  // Profile + domains over fresh defaults (shared/presets.ts composeRun). Every profile and domain works on
  // both engines: switches the engine ignores are turned off (adaptPreset). An invalid composition keeps the
  // settings and records the ids, so the error shows inline and Start is blocked.
  const composeInto = (c: Partial<RunConfig>, comp: Partial<Composition>, engine: EngineId = liveEngineOf(c)): RunConfig => {
    const ablated = c.ablated ?? [];
    if (compositionError(comp, lessons, userDomains)) return { ...fresh(c), ...c, preset: undefined, presets: undefined, ...comp } as RunConfig;
    const composed = composeRun(comp, lessons, undefined, engine, userDomains);
    const out = { ...applyPreset(fresh({ ...c, engine }), { name: composed.label, config: composed.config }), engine, preset: undefined, presets: undefined, effort: composed.effort, supervision: composed.supervision, domains: composed.domains } as RunConfig;
    if (ablated.length) return { ...out, ablated, components: { ...out.components, ...Object.fromEntries(ablated.map((id) => [id, false])) } };
    return { ...out, ablated: undefined };
  };
  // A saved preset over fresh defaults; one that names an engine switches to it.
  const applySaved = (c: Partial<RunConfig>, p: Preset, engine: EngineId = p.config.engine && p.config.engine !== "replay" ? p.config.engine : liveEngineOf(c)): RunConfig => {
    const adapted = adaptPreset({ ...p, adaptive: true }, engine);
    return { ...applyPreset(fresh({ ...c, engine }), { name: p.name, config: { ...adapted.config, engine: undefined } }), engine, preset: p.name, presets: undefined, effort: undefined, supervision: undefined, domains: undefined, ablated: undefined };
  };
  const startOf = (c: Partial<RunConfig>): StartingPoint => (c.preset && saved.some((p) => p.name === c.preset) ? { kind: "saved", name: c.preset } : c.effort ? { kind: "compose", effort: c.effort, supervision: c.supervision ?? "check-in", domains: c.domains ?? [] } : { kind: "custom" });
  /** The settings the current starting point gives, keeping task, folder, title, engine and budget. */
  const startBase = (c: RunConfig): RunConfig => {
    const sp = startOf(c);
    const keep = { task: c.task, workspace: c.workspace, title: c.title, engine: c.engine, budgetUsd: c.budgetUsd };
    if (sp.kind === "saved") return { ...applySaved(keep, saved.find((p) => p.name === sp.name)!, liveEngineOf(c)), engine: c.engine, budgetUsd: c.budgetUsd };
    if (sp.kind === "compose" && !compositionError(sp, lessons)) return { ...composeInto({ ...keep, ablated: c.ablated }, sp, liveEngineOf(c)), engine: c.engine, budgetUsd: c.budgetUsd };
    return fresh(keep);
  };

  // Where New run opens: a prefill (run again, Harness, Lessons), else the surviving draft, else your default
  // (a composition, a domain such as "Web app", a retired name such as "Careful", or a saved preset, mapped by
  // startingPointFor), else medium + check-in.
  const opening = useMemo((): { cfg: RunConfig; notice: string | null; customize: boolean } => {
    const src = prefill ?? draft ?? undefined;
    if (prefill?.__compose) return { cfg: composeInto({ ...prefill, __compose: undefined } as Partial<RunConfig>, prefill.__compose), notice: prefill.__notice ?? null, customize: !!prefill.__openHarness };
    const savedPick = prefill?.__saved ? saved.find((p) => p.name === prefill.__saved) : undefined;
    if (savedPick) return { cfg: applySaved({}, savedPick), notice: null, customize: false };
    if (src) {
      let cfg = defaultRunConfig({ task: "", workspace: info?.defaultWorkspace ?? "", engine: preferredEngine, ...(src as Partial<RunConfig>) });
      let note = prefill?.__notice ?? null;
      // Older runs record presets (["careful","golang","cli"]) or a preset name ("Careful", "Web app",
      // "mine (modified)"): migrate them onto Effort + Supervision + domains.
      if (!cfg.effort && cfg.presets?.length) cfg = { ...cfg, ...compositionOf(cfg), presets: undefined, preset: undefined };
      else if (!cfg.effort && cfg.preset) {
        const sp = startingPointFor(cfg.preset, spOpts);
        cfg = sp.kind === "compose" ? { ...cfg, preset: undefined, effort: sp.effort, supervision: sp.supervision, domains: sp.domains } : sp.kind === "saved" ? { ...cfg, preset: sp.name } : { ...cfg, preset: undefined };
      }
      // Always-tier components stay on; only an experiment (ablated) turns one off.
      const offs = alwaysTierOffs(cfg.components, cfg.ablated ?? []);
      if (offs.length) {
        cfg = { ...cfg, components: { ...cfg.components, ...Object.fromEntries(offs.map((id) => [id, true])) } };
        note = `${offs.map((id) => components.find((c) => c.id === id)?.label ?? id).join(", ")} kept on; an ablation experiment (POST /api/runs with ablated) is the only way to run without.`;
      }
      return { cfg, notice: note, customize: !!prefill?.__openHarness };
    }
    const sp = startingPointFor(defaultPreset, spOpts);
    const savedDef = sp.kind === "saved" ? saved.find((p) => p.name === sp.name) : undefined;
    if (savedDef) return { cfg: applySaved({}, savedDef), notice: null, customize: false };
    if (sp.kind === "compose") return { cfg: composeInto({ engine: sp.engine ?? preferredEngine }, sp, sp.engine ?? preferredEngine), notice: null, customize: false };
    if (defaultComposition) return { cfg: composeInto({ engine: defaultComposition.engine ?? preferredEngine }, defaultComposition, defaultComposition.engine ?? preferredEngine), notice: null, customize: false };
    return { cfg: composeInto({}, {}), notice: null, customize: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, info, defaultPreset, defaultComposition, storePresets, lessons]);
  const [notice, setNotice] = useState<string | null>(opening.notice);
  const [cfg, setCfgRaw] = useState<RunConfig>(opening.cfg);
  const [customizeOpen, setCustomizeOpen] = useState(opening.customize);
  // Until you touch the form it follows its opening point (presets and lessons may arrive after it opens);
  // a new prefill (e.g. "Start a run with Web" while open) always replaces it.
  const touched = useRef(false);
  const lastPrefill = useRef(prefill);
  useEffect(() => {
    const newPrefill = lastPrefill.current !== prefill && !!prefill;
    lastPrefill.current = prefill;
    if (!newPrefill && touched.current) return;
    setCfgRaw(opening.cfg);
    setNotice(opening.notice);
    if (opening.customize) setCustomizeOpen(true);
  }, [opening]);
  const setCfg = (updater: RunConfig | ((c: RunConfig) => RunConfig)) => {
    touched.current = true;
    setCfgRaw(updater);
  };
  // The draft follows every change you make, synced after the render (a store write inside a state updater runs during render, which React warns about).
  useEffect(() => {
    if (touched.current) setNewRunDraft(cfg);
  }, [cfg, setNewRunDraft]);
  const [checkError, setCheckError] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [check, setCheck] = useState<{ exists: boolean; git: boolean; files: string[]; path: string; suggestions?: { domain: string; reason: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState<"harness" | "roles" | "context" | "guardrails">("harness");
  const [sameModel, setSameModel] = useState(true);

  useEffect(() => {
    api.workspaces().then((w) => setRecent(w.recent)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!cfg.workspace) return setCheck(null);
    setCheckError(false);
    const t = setTimeout(
      () =>
        api
          .checkWorkspace(cfg.workspace)
          .then(setCheck)
          .catch(() => {
            setCheck(null);
            setCheckError(true);
          }),
      250,
    );
    return () => clearTimeout(t);
  }, [cfg.workspace]);

  const set = (patch: Partial<RunConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const setRole = (role: keyof RunConfig["roles"], patch: Partial<RunConfig["roles"]["builder"]>) =>
    setCfg((c) => {
      const roles = { ...c.roles, [role]: { ...c.roles[role], ...patch } };
      if (sameModel && role === "builder" && patch.model) {
        roles.planner = { ...roles.planner, model: patch.model };
        roles.evaluator = { ...roles.evaluator, model: patch.model };
      }
      return { ...c, roles };
    });
  const toggle = (id: ComponentId) => set({ components: { ...cfg.components, [id]: !cfg.components[id] } });

  const engineNow = liveEngineOf(cfg);
  const start = startOf(cfg);
  const activeSaved = start.kind === "saved" ? saved.find((p) => p.name === start.name) : undefined;
  const composed = start.kind === "compose" && !compositionError(start, lessons) ? composeRun(start, lessons, undefined, engineNow) : null;
  const basis: PresetBasis[] | undefined = composed?.basis ?? activeSaved?.basis;
  // One short note when the engine ignores switches the starting point turns on (they are switched off).
  const sourceConfig = composed?.config ?? activeSaved?.config;
  const adapted = sourceConfig && !(sourceConfig.engine && sourceConfig.engine !== engineNow) ? presetCompatibility({ config: sourceConfig, adaptive: true }, engineNow) : null;
  const engineNote = adapted?.adaptive && adapted.dropped.length ? adapted.reasons[0] : null;

  const pickSaved = (name: string) => {
    const p = saved.find((x) => x.name === name);
    if (!p) return setCfg((c) => composeInto(c, {}));
    const switched = p.config.engine && p.config.engine !== "replay" && p.config.engine !== engineNow ? p.config.engine : null;
    setCfg((c) => applySaved(c, p));
    setNotice(switched ? `“${p.name}” is set up for ${ENGINE_LABEL[switched]}, so the engine switched to it.` : null);
  };
  const switchEngine = (id: EngineId) => {
    if (id === cfg.engine) return;
    setNotice(null);
    // Re-derive the starting point for the new engine (switches it ignores go off).
    if (start.kind === "compose" && composed) return setCfg((c) => ({ ...composeInto({ ...c, engine: id }, start, id), roles: c.roles, guidance: c.guidance }));
    if (activeSaved) return setCfg((c) => applySaved({ ...c, engine: id }, activeSaved, id));
    set({ engine: id });
  };
  const setGuidance = (lines: string[]) => set({ guidance: lines });
  const openLesson = (slug: string) => {
    openModal(null);
    setLessonFilter(slug);
  };
  const [saving, setSaving] = useState<null | { name: string; makeDefault: boolean }>(null);
  const savePreset = async () => {
    if (!saving?.name.trim()) return;
    try {
      const r = await api.savePreset({ name: saving.name, config: presetFromConfig(cfg), default: saving.makeDefault, ...(basis?.length ? { lessons: [...new Set(basis.map((b) => b.slug))] } : {}) });
      await refreshPresets();
      set({ preset: r.preset.name, presets: undefined, effort: undefined, supervision: undefined, domains: undefined });
      setSaving(null);
      toastMsg(`Saved preset "${r.preset.name}"${r.default === r.preset.name ? " as your default" : ""}.${r.dropped.length ? ` Dropped: ${r.dropped.join(", ")}.` : ""}`);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    }
  };
  // Customize counts what you changed on top of the starting point (not the engine or budget, which sit outside it).
  const base = startBase(cfg);
  const diffMap = (c: RunConfig) => new Map(diffFromDefaults(c).filter((d) => d.path !== "engine" && d.path !== "budgetUsd").map((d) => [d.path, d] as const));
  const mineMap = diffMap(cfg);
  const baseMap = diffMap(base);
  const guidanceChanged = JSON.stringify(cfg.guidance ?? []) !== JSON.stringify(base.guidance ?? []);
  const changes = [
    ...[...new Set([...mineMap.keys(), ...baseMap.keys()])].filter((k) => mineMap.get(k)?.text !== baseMap.get(k)?.text).map((k) => mineMap.get(k)?.text ?? `${baseMap.get(k)!.label}: ${baseMap.get(k)!.from} (was ${baseMap.get(k)!.to})`),
    ...(guidanceChanged && !mineMap.has("guidance") && !baseMap.has("guidance") ? ["Guidance edited"] : []),
  ];
  const resetCustomize = () => setCfg((c) => startBase(c));
  const warnings = checkRunConfig(cfg);
  const liveEngine = cfg.engine === "replay" ? null : cfg.engine;

  const tokenBudget = cfg.engine === "claude-code";
  const budgetOk = tokenBudget ? Number.isFinite(cfg.budgetTokens ?? NaN) && (cfg.budgetTokens ?? 0) >= 10_000 : Number.isFinite(cfg.budgetUsd) && cfg.budgetUsd >= 1;
  const engineOk = cfg.engine === "anthropic" ? !!info?.hasApiKey : !!info?.hasClaudeCode;
  const composeError = cfg.effort ? compositionError({ effort: cfg.effort, supervision: cfg.supervision, domains: cfg.domains }, lessons, userDomains) : null;
  const blocker = composeError ? `Start from: ${composeError}.` : cfg.task.trim().length <= 3 ? "Describe the task first." : !cfg.workspace ? "Pick a workspace folder." : check === null ? (checkError ? "Could not check the folder; is the server running?" : "Checking the folder…") : !check.exists ? "That folder does not exist." : !engineOk ? (cfg.engine === "anthropic" ? "The direct engine needs an API key (Settings), or pick Claude Code above." : "Claude Code is not installed; add an API key and pick the direct engine.") : !budgetOk ? (tokenBudget ? "Token budget must be at least 10,000." : "Budget must be at least $1.") : null;
  const canStart = blocker === null;
  const startRun = async (engine: "live" | "replay") => {
    setBusy(true);
    try {
      const preset = activeSaved ? (changes.length ? `${activeSaved.name} (modified)` : activeSaved.name) : undefined;
      const created = engine === "replay" ? await api.demo() : await api.createRun({ ...cfg, preset, presets: undefined, ...(cfg.ablated?.length ? {} : { ablated: undefined }), title: cfg.title || cfg.task.slice(0, 60) });
      if (engine !== "replay") setNewRunDraft(null);
      openModal(null);
      selectRun(created.id, { view: "activity" });
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const est = estimate(cfg);

  return (
    <Modal title={prefill && !prefill.__compose && !prefill.__saved ? "New run from these settings" : "New run"} onClose={() => openModal(null)} width={760} dismissOnBackdrop={false}>
      <div className="flex flex-col gap-5">
        <div>
          <label className="text-[12px] font-semibold" htmlFor="newrun-task">What should the agent do?</label>
          <textarea
            id="newrun-task"
            className="input mt-1"
            rows={4}
            autoFocus
            placeholder="Describe the outcome, not the steps. Example: Add a GET /health endpoint that returns uptime and the git sha, with a test and a README section."
            value={cfg.task}
            onChange={(e) => set({ task: e.target.value })}
          />
          <div className="faint text-[11.5px] mt-1">A short task is fine: the planner turns it into a spec, and you approve the definition of done before any code is written.</div>
        </div>

        <div>
          <label className="text-[12px] font-semibold" htmlFor="newrun-workspace">Workspace folder</label>
          <input id="newrun-workspace" className="input mono mt-1" list="recent-ws" value={cfg.workspace} onChange={(e) => set({ workspace: e.target.value })} placeholder="/path/to/your/repo" />
          <datalist id="recent-ws">
            {recent.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <div className="flex items-center gap-2 mt-1.5 text-[11.5px] min-h-[18px]">
            {check === null ? (
              <span className={checkError ? "text-[var(--bad)]" : "faint"}>{checkError ? "Could not check the folder (server unreachable)." : cfg.workspace ? "Checking…" : "Type or pick a folder."}</span>
            ) : !check.exists ? (
              <Badge tone="bad">folder not found</Badge>
            ) : (
              <>
                <Badge tone="ok">found</Badge>
                <Badge tone={check.git ? "ok" : "warn"}>{check.git ? "git repository" : "not a git repo: commits off"}</Badge>
                <span className="muted truncate">{check.files.join(", ")}</span>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="text-[12px] font-semibold" id="newrun-engine-label">Engine</div>
          <div className="flex gap-2 mt-1" role="group" aria-labelledby="newrun-engine-label">
            {(
              [
                ["anthropic", "Direct API", info?.hasApiKey ? "Reins runs the whole loop. Uses your API key." : "Needs an API key (Settings)."],
                ["claude-code", "Claude Code", info?.hasClaudeCode ? "Runs each role through your local Claude Code login." : "The claude CLI was not found on this machine."],
              ] as const
            ).map(([id, label, desc]) => (
              <button key={id} type="button" data-engine={id} aria-pressed={cfg.engine === id} className={`flex-1 rounded-lg border p-2.5 text-left ${cfg.engine === id ? "border-[var(--accent)] sunk" : "line"}`} onClick={() => switchEngine(id)}>
                <div className="font-medium text-[12.5px] flex items-center gap-2">
                  {label}
                  {(id === "anthropic" ? info?.hasApiKey : info?.hasClaudeCode) ? <Badge tone="ok">ready</Badge> : <Badge tone="warn">unavailable</Badge>}
                </div>
                <div className="muted text-[11.5px] leading-snug">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {!!cfg.ablated?.length && (
          <div className="rounded-lg border border-[var(--warn)] bg-[var(--warn-soft,transparent)] px-3 py-2 text-[12.5px]" data-experiment-banner role="status">
            <b>Experiment:</b> run without {cfg.ablated.map((id) => components.find((c) => c.id === id)?.label ?? id).join(", ")}. Always-on components are off only in an experiment like this; the run records it in its title chip.{" "}
            <button type="button" className="link" onClick={() => setCfg((c) => ({ ...c, ablated: undefined, components: { ...c.components, ...Object.fromEntries((c.ablated ?? []).map((id) => [id, true])) } }))}>
              Cancel the experiment
            </button>
          </div>
        )}
        <section className="rounded-lg border line p-3 flex flex-col gap-2" data-start-from aria-labelledby="start-from-label">
          <div className="text-[12px] font-semibold" id="start-from-label">
            Start from
          </div>
          <ComposePicker
            lessons={lessons}
            userDomains={userDomains}
            onBuildDomain={() => openDomainBuilder()}
            value={cfg.effort ? { effort: cfg.effort, supervision: cfg.supervision, domains: cfg.domains ?? [] } : null}
            suggestions={check?.exists ? (check.suggestions ?? []) : []}
            onOpenLesson={openLesson}
            onChange={(comp) => {
              setNotice(null);
              setCfg((c) => composeInto({ ...c, preset: undefined }, comp));
            }}
          />
          {saved.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <label className="font-semibold" htmlFor="saved-preset">
                Or a saved preset
              </label>
              <select id="saved-preset" data-saved-preset className="input" style={{ width: 220 }} value={activeSaved?.name ?? ""} onChange={(e) => pickSaved(e.target.value)}>
                <option value="">—</option>
                {saved.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="text-[12px] leading-snug" data-active-start>
            <span className="muted">Starting from </span>
            <span className="font-medium">{describeStart(start)}</span>
            {changes.length > 0 && <span className="muted"> with {changes.length} change{changes.length === 1 ? "" : "s"}</span>}
            {activeSaved?.description && <span className="muted"> — {activeSaved.description}</span>}
          </div>
          {engineNote && (
            <div className="faint text-[11.5px] leading-snug" data-engine-note>
              {engineNote}
            </div>
          )}
          {notice && (
            <div className="text-[11.5px] leading-snug" role="status" data-preset-notice>
              <Badge tone="warn">note</Badge> {notice}
            </div>
          )}
        </section>

        <div className="flex items-end gap-3">
          {tokenBudget ? (
            <Field label="Budget (tokens)">
              <input className="input" style={{ width: 140 }} type="number" min={10_000} step={50_000} value={cfg.budgetTokens ?? ""} onChange={(e) => set({ budgetTokens: Math.max(0, Number(e.target.value) || 0) })} aria-invalid={!budgetOk} data-budget-tokens />
            </Field>
          ) : (
            <Field label="Budget (USD)">
              <input className="input" style={{ width: 120 }} type="number" min={1} step={1} value={cfg.budgetUsd} onChange={(e) => set({ budgetUsd: Math.max(0, Number(e.target.value) || 0) })} aria-invalid={!budgetOk} data-budget />
            </Field>
          )}
          <div className="muted text-[11.5px] leading-snug pb-1">{tokenBudget ? "Usage counts against your Claude subscription, so the cap is tokens (input + output + cache writes, cache reads at a tenth). The run stops when it reaches it." : "The run stops when it reaches the budget."}</div>
        </div>

        <details className="rounded-lg border line" data-customize open={customizeOpen} onToggle={(e) => setCustomizeOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] flex items-center gap-2">
            <span className="font-semibold">Customize</span>
            <span className="faint text-[11.5px]">model, switches, roles, context, guardrails, guidance</span>
            <span className="flex-1" />
            {changes.length > 0 && (
              <span className="badge badge-accent" data-customize-count>
                {changes.length} change{changes.length === 1 ? "" : "s"}
              </span>
            )}
          </summary>
          {customizeOpen && (
          <div className="flex flex-col gap-4 px-3 pb-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="muted text-[11.5px]">Changes here apply on top of {describeStart(start)}.</span>
              <span className="flex-1" />
              <button className="btn btn-ghost btn-sm" onClick={resetCustomize} disabled={!changes.length} data-customize-reset>
                Reset
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSaving(saving ? null : { name: activeSaved?.name ?? "", makeDefault: false })}>
                Save as preset…
              </button>
            </div>
            {saving && (
              <div className="flex flex-wrap items-center gap-2 fade-in">
                <input className="input" style={{ width: 220 }} autoFocus placeholder="Preset name" value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void savePreset()} aria-label="Preset name" />
                <label className="flex items-center gap-1.5 text-[12px]">
                  <input type="checkbox" checked={saving.makeDefault} onChange={(e) => setSaving({ ...saving, makeDefault: e.target.checked })} /> make it my default
                </label>
                <button className="btn btn-sm btn-primary" disabled={!saving.name.trim()} onClick={() => void savePreset()}>
                  Save
                </button>
                <span className="faint text-[11px]">Saves engine, switches, roles, pauses, context, guardrails and limits; never the task or folder. Manage saved presets on Harness.</span>
              </div>
            )}
            {changes.length > 0 && (
              <ul className="text-[11.5px] mono flex flex-col gap-0.5">
                {changes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Model">
                <select className="input" value={cfg.roles.builder.model} onChange={(e) => setRole("builder", { model: e.target.value })} data-model>
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · ${m.inputPerM}/${m.outputPerM} per M
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reasoning effort">
                <select className="input" value={cfg.roles.builder.effort} onChange={(e) => setRole("builder", { effort: e.target.value as EffortLevel })}>
                  {EFFORTS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Customize">
              {(["harness", "roles", "context", "guardrails"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={advanced === k} className={`btn btn-sm ${advanced === k ? "" : "btn-ghost"}`} onClick={() => setAdvanced(k)} data-customize-tab={k}>
                  {k === "harness" ? `Components · ${Object.values(cfg.components).filter(Boolean).length}/${components.length} on` : k === "roles" ? "Roles & pauses" : k === "context" ? "Context" : `Guardrails · ${cfg.guardrail.mode}`}
                </button>
              ))}
            </div>
            {advanced === "harness" && (
              <div className="flex flex-col gap-3 fade-in">
                {[...new Set(components.filter((c) => c.tier !== "always").map((c) => c.group))].map((g) => (
                  <div key={g}>
                    <div className="section-label mb-1.5">{GROUP_LABEL[g as HarnessComponent["group"]]}</div>
                    <div className="grid md:grid-cols-2 gap-2">
                      {components
                        .filter((c) => c.group === g && c.tier !== "always")
                        .map((c) => {
                          const ignored = liveEngine && !c.engines.includes(liveEngine);
                          const inert = c.id === "osSandbox" && info && !info.sandboxAvailable;
                          const unmet = cfg.components[c.id] ? (c.requires ?? []).filter((r) => !cfg.components[r.id]) : [];
                          return (
                            <div key={c.id} className="rounded-lg border line p-2.5 flex gap-2 items-start">
                              <Switch checked={cfg.components[c.id]} onChange={() => toggle(c.id)} label={c.label} />
                              <div className="min-w-0">
                                <div className="font-medium text-[12.5px] flex flex-wrap items-center gap-1">
                                  {c.label}
                                  {inert && (
                                    <Badge tone="warn" title="sandbox-exec is macOS-only; on this platform shell commands run under the guardrails without an OS sandbox">
                                      unavailable on this platform
                                    </Badge>
                                  )}
                                  {ignored && (
                                    <Badge tone={cfg.components[c.id] ? "warn" : "neutral"} title={`Only the ${c.engines.map((e) => ENGINE_LABEL[e]).join(" / ")} engine honours this switch`}>
                                      ignored on this engine
                                    </Badge>
                                  )}
                                  {(c.requires ?? []).map((r) => (
                                    <Badge key={r.id} tone={unmet.some((u) => u.id === r.id) ? "warn" : "neutral"} title={r.reason}>
                                      needs {components.find((x) => x.id === r.id)?.label ?? r.id}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="muted text-[11.5px] leading-snug">{c.short}</div>
                                <div className="faint text-[11px] leading-snug mt-0.5">when off: {c.whenOff}</div>
                                <button className="text-[11px] underline muted mt-0.5" onClick={() => { openModal(null); setLessonFilter(c.lessons[0]); }}>
                                  why
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}
    
            {advanced === "roles" && (
              <div className="fade-in flex flex-col gap-3">
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={sameModel} onChange={(e) => setSameModel(e.target.checked)} /> Use the same model for planner, builder and evaluator
                </label>
                <div className="grid md:grid-cols-2 gap-2">
                  {(["planner", "builder", "evaluator", "classifier", "scout"] as const).map((r) => (
                    <div key={r} className="rounded-lg border line p-2.5">
                      <div className={`font-medium text-[12.5px] role-${r} capitalize`}>{r}</div>
                      <div className="flex gap-2 mt-1.5">
                        <select className="input" value={cfg.roles[r].model} onChange={(e) => setRole(r, { model: e.target.value })} disabled={sameModel && (r === "planner" || r === "evaluator")}>
                          {MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <select className="input" style={{ width: 110 }} value={cfg.roles[r].effort} onChange={(e) => setRole(r, { effort: e.target.value as EffortLevel })}>
                          {EFFORTS.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[12px] font-semibold mb-1">Pause for you…</div>
                  <div className="flex flex-wrap gap-3 text-[12.5px]">
                    {(
                      [
                        ["afterPlan", "after the plan"],
                        ["afterContract", "to approve the contract"],
                        ["beforeCommit", "before each commit"],
                        ["afterEvaluation", "after each evaluation"],
                        ["beforePublish", "before publishing"],
                        ["beforeMerge", "before each merge"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={cfg.pauses[k]} onChange={(e) => set({ pauses: { ...cfg.pauses, [k]: e.target.checked } })} /> {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max turns per phase">
                    <input className="input" type="number" min={5} value={cfg.maxTurnsPerPhase} onChange={(e) => set({ maxTurnsPerPhase: Number(e.target.value) })} />
                  </Field>
                  <Field label="Fix rounds after a failed evaluation">
                    <input className="input" type="number" min={0} max={5} value={cfg.maxFixRounds} onChange={(e) => set({ maxFixRounds: Number(e.target.value) })} />
                  </Field>
                </div>
              </div>
            )}
    
            {advanced === "context" && (
              <div className="grid grid-cols-3 gap-3 fade-in">
                <Field label="Compact at (tokens)" hint="server-side summary of older history">
                  <input className="input" type="number" step={10000} value={cfg.context.compactAtTokens} onChange={(e) => set({ context: { ...cfg.context, compactAtTokens: Number(e.target.value) } })} />
                </Field>
                <Field label="Keep last N tool results" hint="older ones are cleared">
                  <input className="input" type="number" min={1} value={cfg.context.clearToolResultsAfterTurns} onChange={(e) => set({ context: { ...cfg.context, clearToolResultsAfterTurns: Number(e.target.value) } })} />
                </Field>
                <Field label="Reset at (tokens)" hint="fresh conversation from the progress notes">
                  <input className="input" type="number" step={10000} value={cfg.context.resetAtTokens} onChange={(e) => set({ context: { ...cfg.context, resetAtTokens: Number(e.target.value) } })} />
                </Field>
              </div>
            )}
    
            {advanced === "guardrails" && (
              <div className="fade-in flex flex-col gap-3">
                <div className="flex gap-2">
                  {(
                    [
                      ["auto", "Auto", "rules decide; the classifier settles ambiguous commands"],
                      ["ask", "Ask", "anything that is not read-only asks you"],
                      ["trust", "Trust", "only hard denies are enforced"],
                    ] as const
                  ).map(([m, label, desc]) => (
                    <button key={m} className={`flex-1 rounded-lg border p-2.5 text-left ${cfg.guardrail.mode === m ? "border-[var(--accent)] sunk" : "line"}`} onClick={() => set({ guardrail: { ...cfg.guardrail, mode: m } })}>
                      <div className="font-medium text-[12.5px]">{label}</div>
                      <div className="muted text-[11.5px] leading-snug">{desc}</div>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={cfg.guardrail.allowNetwork} onChange={(e) => set({ guardrail: { ...cfg.guardrail, allowNetwork: e.target.checked } })} /> Allow network (package installs, fetches) without asking
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Allow without asking (narrow regex, one per line)" hint="blanket interpreters like ^python are ignored">
                    <textarea className="input mono" rows={3} value={(cfg.guardrail.allowPatterns ?? []).join("\n")} onChange={(e) => set({ guardrail: { ...cfg.guardrail, allowPatterns: e.target.value.split("\n").filter(Boolean) } })} />
                  </Field>
                  <Field label="Always ask (regex, one per line)">
                    <textarea className="input mono" rows={3} value={cfg.guardrail.askPatterns.join("\n")} onChange={(e) => set({ guardrail: { ...cfg.guardrail, askPatterns: e.target.value.split("\n").filter(Boolean) } })} />
                  </Field>
                  <Field label="Always deny (regex, one per line)">
                    <textarea className="input mono" rows={3} value={cfg.guardrail.denyPatterns.join("\n")} onChange={(e) => set({ guardrail: { ...cfg.guardrail, denyPatterns: e.target.value.split("\n").filter(Boolean) } })} />
                  </Field>
                </div>
              </div>
            )}
            <GuidanceEditor lines={cfg.guidance ?? []} onChange={setGuidance} />
            {basis && basis.length > 0 && (
              <details className="text-[11.5px] leading-snug" data-preset-basis>
                <summary className="cursor-pointer">
                  <span className="font-semibold">Shaped by {basis.length} lesson{basis.length === 1 ? "" : "s"}</span>
                </summary>
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {basis.map((b) => (
                    <li key={b.slug + b.effect}>
                      <button type="button" className="underline" onClick={() => openLesson(b.slug)} title="Open this lesson">
                        {b.title}
                      </button>{" "}
                      <span className="muted">— {b.effect}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          )}
        </details>

        {warnings.length > 0 && (
          <div className="rounded-lg p-2.5 text-[12px] flex flex-col gap-1" style={{ background: "var(--warn-soft)" }} role="status" aria-live="polite">
            <div className="font-semibold text-[var(--warn)]">
              {warnings.length} config warning{warnings.length === 1 ? "" : "s"} (the run still starts; they are recorded in its log)
            </div>
            <ul className="flex flex-col gap-0.5">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t line">
          <div className="muted text-[12px] leading-snug">
            {cfg.engine === "claude-code" ? (
              <>Uses your Claude subscription (cap {tokens(cfg.budgetTokens ?? 0)} tokens); dollar figures are list-price estimates, not bills.</>
            ) : (
              <>
                Rough estimate: <span className="mono">~{est}</span>.
              </>
            )}
            {blocker && <div className="text-[var(--warn)] mt-0.5">{blocker}</div>}
            {cfg.engine === "anthropic" && !info?.hasApiKey && (
              <div className="text-[var(--warn)]">
                No API key yet.{" "}
                <button className="underline" onClick={() => openModal("settings")}>
                  Add one
                </button>
                {info?.hasClaudeCode ? ", or pick the Claude Code engine above." : ", or watch the demo."}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <button className="btn" disabled={busy} onClick={() => startRun("replay")}>
            ▶ Watch demo instead
          </button>
          <button className="btn btn-primary" disabled={busy || !canStart} onClick={() => startRun("live")} title={!canStart ? "Enter a task, an existing folder, and pick an available engine" : undefined} data-start>
            Start run
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold">{label}</span>
      {children}
      {hint && <span className="faint text-[11px]">{hint}</span>}
    </label>
  );
}

function estimate(cfg: RunConfig): string {
  const m = MODELS.find((x) => x.id === cfg.roles.builder.model) ?? MODELS[0];
  // ~40 turns, ~25k prompt tokens avg (85% cached), ~600 output tokens per turn.
  const phases = 1 + (cfg.components.planner ? 1 : 0) + (cfg.components.contracts ? 1 : 0) + (cfg.components.evaluator ? 1.5 : 0);
  const turns = 12 * phases;
  const cost = turns * ((25_000 * 0.15 * m.inputPerM + 25_000 * 0.85 * m.cacheReadPerM + 600 * m.outputPerM) / 1e6);
  return `$${cost.toFixed(2)}–$${(cost * 3).toFixed(2)}, ${Math.round(turns)}–${Math.round(turns * 2.5)} model calls`;
}

/** Run guidance shown before start: every line is appended to each role's system prompt; edit or remove any. */
function GuidanceEditor({ lines, onChange }: { lines: string[]; onChange: (l: string[]) => void }) {
  return (
    <div className="text-[11.5px] flex flex-col gap-1" data-guidance>
      <div className="flex items-center gap-2">
        <span className="font-semibold">Guidance for this run</span>
        <span className="faint">{lines.length ? "added to every role's instructions" : "none"}</span>
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...lines, ""])} disabled={lines.length >= 10}>
          Add line
        </button>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input className="input flex-1" value={l} maxLength={200} aria-label={`Guidance line ${i + 1}`} onChange={(e) => onChange(lines.map((x, j) => (j === i ? e.target.value.replace(/[\r\n]+/g, " ") : x)))} />
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove guidance line ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
