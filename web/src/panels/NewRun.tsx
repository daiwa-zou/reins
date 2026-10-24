import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Switch, Badge } from "../components/ui";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { defaultRunConfig, MODELS } from "@shared/components";
import { applyPreset, BUILT_IN_PRESETS, checkRunConfig, diffFromDefaults, ENGINE_LABEL, presetFromConfig } from "@shared/config";
import { money } from "../lib/format";
import type { ComponentId, EffortLevel, EngineId, HarnessComponent, Preset, PresetBasis, RunConfig } from "@shared/types";
import { adaptPreset, generatedPresets, presetCompatibility } from "@shared/presets";
import { GROUP_LABEL } from "./Harness";

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * One form, three depths: the task and the folder are all you need; the
 * harness, context and guardrail sections are open for the curious.
 */
export function NewRun() {
  const openModal = useStore((s) => s.openModal);
  const prefill = useStore((s) => s.newRunPrefill);
  const info = useStore((s) => s.info);
  const components = useStore((s) => s.components);
  const selectRun = useStore((s) => s.selectRun);
  const toastMsg = useStore((s) => s.toastMsg);
  const setLessonFilter = useStore((s) => s.setLessonFilter);

  const draft = useStore((s) => s.newRunDraft);
  const setNewRunDraft = useStore((s) => s.setNewRunDraft);
  const storePresets = useStore((s) => s.presets);
  const defaultPreset = useStore((s) => s.defaultPreset);
  const refreshPresets = useStore((s) => s.refreshPresets);
  const presets: (Preset & { isDefault?: boolean })[] = storePresets.length ? storePresets : [...BUILT_IN_PRESETS, ...generatedPresets([])];
  const preferredEngine = info?.hasApiKey ? "anthropic" : info?.hasClaudeCode ? "claude-code" : "anthropic";
  const fresh = (keep: Partial<RunConfig> = {}) => defaultRunConfig({ task: keep.task ?? "", workspace: keep.workspace ?? info?.defaultWorkspace ?? "", engine: (keep.engine as RunConfig["engine"]) ?? preferredEngine, title: keep.title });
  // Start from: the prefill (run again / Harness), else the surviving draft, else your default preset, else the defaults.
  // "My default" is applied only if it fits the engine New run opens on; otherwise the defaults, with a notice.
  const opening = useMemo((): { cfg: RunConfig; notice: string | null } => {
    if (prefill || draft) return { cfg: defaultRunConfig({ task: "", workspace: info?.defaultWorkspace ?? "", engine: preferredEngine, ...((prefill ?? draft) as any) }), notice: ((prefill as any)?.__notice as string) ?? null };
    const def = defaultPreset ? presets.find((p) => p.name === defaultPreset) : undefined;
    if (!def) return { cfg: fresh(), notice: null };
    const fit = presetCompatibility(def, preferredEngine);
    if (!fit.ok) return { cfg: fresh(), notice: `Your default preset "${def.name}" does not fit ${ENGINE_LABEL[preferredEngine]} (${fit.reasons[0]}), so New run starts from the defaults.` };
    return { cfg: applyPreset(fresh(), adaptPreset(def, preferredEngine)), notice: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, info]);
  const base = opening.cfg;
  const [notice, setNotice] = useState<string | null>(opening.notice);
  // A preset built in Lessons ("Build a preset from these") brings its basis along.
  const prefillBasis = ((prefill as any)?.__basis as PresetBasis[] | undefined) ?? undefined;
  const [cfg, setCfgRaw] = useState<RunConfig>(base);
  // A new prefill while the dialog is open (e.g. "Build a preset from these") replaces the config and notice.
  const firstPrefill = useRef(true);
  useEffect(() => {
    if (firstPrefill.current) {
      firstPrefill.current = false;
      return;
    }
    if (!prefill) return;
    setCfgRaw(opening.cfg);
    setNotice(opening.notice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const setCfg = (updater: RunConfig | ((c: RunConfig) => RunConfig)) =>
    setCfgRaw((c) => {
      const next = typeof updater === "function" ? updater(c) : updater;
      setNewRunDraft(next);
      return next;
    });
  const [checkError, setCheckError] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [check, setCheck] = useState<{ exists: boolean; git: boolean; files: string[]; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState<null | "harness" | "roles" | "context" | "guardrails">((prefill as any)?.__openHarness ? "harness" : null);
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

  // Presets: pick one (applied over fresh defaults, keeping task, folder and engine unless the preset sets one).
  const activePreset = cfg.preset ? presets.find((p) => p.name === cfg.preset) : undefined;
  const engineNow: EngineId = cfg.engine === "replay" ? preferredEngine : cfg.engine;
  const presetModified = !!activePreset && JSON.stringify(diffFromDefaults(applyPreset(fresh(cfg), adaptPreset(activePreset, engineNow)))) !== JSON.stringify(diffFromDefaults(cfg));
  const activeFit = activePreset ? presetCompatibility(activePreset, engineNow) : null;
  const basis = activePreset?.basis ?? (cfg.preset ? undefined : prefillBasis);
  // Presets are gated by engine (shared/presets.ts presetCompatibility): one that names an engine switches to it;
  // one that turns on switches this engine ignores is unavailable unless it adapts.
  const pickPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) {
      setNotice(null);
      return set({ preset: undefined });
    }
    if (p.config.engine && p.config.engine !== engineNow) {
      setCfg(applyPreset(fresh({ ...cfg, engine: p.config.engine }), p));
      return setNotice(`${p.name} is made for ${ENGINE_LABEL[p.config.engine]}, so the engine switched from ${ENGINE_LABEL[engineNow]} to ${ENGINE_LABEL[p.config.engine]}.`);
    }
    const fit = presetCompatibility(p, engineNow);
    if (!fit.ok) return setNotice(`${p.name} is not available: ${fit.reasons[0]}`);
    setCfg(applyPreset(fresh(cfg), adaptPreset(p, engineNow)));
    setNotice(null);
  };
  const switchEngine = (id: EngineId) => {
    if (id === cfg.engine) return;
    if (activePreset) {
      const fit = presetCompatibility(activePreset, id);
      if (!fit.ok) {
        set({ engine: id, preset: undefined });
        return setNotice(`${activePreset.name} does not fit ${ENGINE_LABEL[id]} (${fit.reasons[0]}), so the preset is now Custom; your settings are kept.`);
      }
      if (fit.adaptive || presetCompatibility(activePreset, engineNow).adaptive) {
        setNotice(null);
        return setCfg(applyPreset(fresh({ ...cfg, engine: id }), adaptPreset(activePreset, id)));
      }
    }
    setNotice(null);
    set({ engine: id });
  };
  const setGuidance = (lines: string[]) => set({ guidance: lines });
  const openLesson = (slug: string) => {
    openModal(null);
    setLessonFilter(slug);
  };
  const resetToDefaults = () => setCfg(fresh({ task: cfg.task, workspace: cfg.workspace, title: cfg.title }));
  const [saving, setSaving] = useState<null | { name: string; makeDefault: boolean }>(null);
  const savePreset = async () => {
    if (!saving?.name.trim()) return;
    try {
      const r = await api.savePreset({ name: saving.name, config: presetFromConfig(cfg), default: saving.makeDefault, ...(basis?.length ? { lessons: basis.map((b) => b.slug) } : {}) });
      await refreshPresets();
      set({ preset: r.preset.name });
      setSaving(null);
      toastMsg(`Saved preset "${r.preset.name}"${r.default === r.preset.name ? " as your default" : ""}.${r.dropped.length ? ` Dropped: ${r.dropped.join(", ")}.` : ""}`);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    }
  };
  const makeDefault = async (name: string | null) => {
    try {
      await api.setDefaultPreset(name);
      await refreshPresets();
      toastMsg(name ? `"${name}" is now your New run default.` : "New run starts from the defaults again.");
    } catch (e) {
      toastMsg((e as Error).message, "error");
    }
  };
  const changes = diffFromDefaults(cfg);
  const [showChanges, setShowChanges] = useState(false);
  const warnings = checkRunConfig(cfg);
  const liveEngine = cfg.engine === "replay" ? null : cfg.engine;

  const budgetOk = Number.isFinite(cfg.budgetUsd) && cfg.budgetUsd >= 1;
  const engineOk = cfg.engine === "anthropic" ? !!info?.hasApiKey : !!info?.hasClaudeCode;
  const blocker = cfg.task.trim().length <= 3 ? "Describe the task first." : !cfg.workspace ? "Pick a workspace folder." : check === null ? (checkError ? "Could not check the folder; is the server running?" : "Checking the folder…") : !check.exists ? "That folder does not exist." : !engineOk ? (cfg.engine === "anthropic" ? "The direct engine needs an API key (Settings), or pick Claude Code above." : "Claude Code is not installed; add an API key and pick the direct engine.") : !budgetOk ? "Budget must be at least $1." : null;
  const canStart = blocker === null;
  const start = async (engine: "live" | "replay") => {
    setBusy(true);
    try {
      const preset = cfg.preset ? (presetModified ? `${cfg.preset} (modified)` : cfg.preset) : undefined;
      const created = engine === "replay" ? await api.demo() : await api.createRun({ ...cfg, preset, title: cfg.title || cfg.task.slice(0, 60) });
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
    <Modal title={prefill ? "New run from these settings" : "New run"} onClose={() => openModal(null)} width={760} dismissOnBackdrop={false}>
      <div className="flex flex-col gap-5">
        <div>
          <label className="text-[12px] font-semibold">What should the agent do?</label>
          <textarea
            className="input mt-1"
            rows={4}
            autoFocus
            placeholder="Describe the outcome, not the steps. Example: Add a GET /health endpoint that returns uptime and the git sha, with a test and a README section."
            value={cfg.task}
            onChange={(e) => set({ task: e.target.value })}
          />
          <div className="faint text-[11.5px] mt-1">A short task is fine: the planner expands it into a spec and feature list, and you approve the definition of done before code is written.</div>
        </div>

        <div>
          <label className="text-[12px] font-semibold">Workspace folder</label>
          <input className="input mono mt-1" list="recent-ws" value={cfg.workspace} onChange={(e) => set({ workspace: e.target.value })} placeholder="/path/to/your/repo" />
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
          <label className="text-[12px] font-semibold">Engine</label>
          <div className="flex gap-2 mt-1">
            {(
              [
                ["anthropic", "Direct API", info?.hasApiKey ? "Reins owns the loop: compaction, tool search, task budgets, every switch below. Needs an API key." : "Needs an API key (Settings). Reins owns the whole loop."],
                ["claude-code", "Claude Code", info?.hasClaudeCode ? "Runs each role through the local Claude Code login. Reins keeps the contract, evaluator, guardrails and log; Claude Code keeps context management." : "The claude CLI was not found on this machine."],
              ] as const
            ).map(([id, label, desc]) => (
              <button key={id} type="button" className={`flex-1 rounded-lg border p-2.5 text-left ${cfg.engine === id ? "border-[var(--accent)] sunk" : "line"}`} onClick={() => switchEngine(id)}>
                <div className="font-medium text-[12.5px] flex items-center gap-2">
                  {label}
                  {(id === "anthropic" ? info?.hasApiKey : info?.hasClaudeCode) ? <Badge tone="ok">ready</Badge> : <Badge tone="warn">unavailable</Badge>}
                </div>
                <div className="muted text-[11.5px] leading-snug">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border line p-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <label className="font-semibold" htmlFor="preset-pick">
              Preset
            </label>
            <select id="preset-pick" className="input" style={{ width: 200 }} value={activePreset ? activePreset.name : ""} onChange={(e) => pickPreset(e.target.value)}>
              <option value="">Custom (no preset)</option>
              {presets.map((p) => {
                const fit = presetCompatibility(p, engineNow);
                // A preset made for the other engine stays pickable (it switches the engine); one that needs the other engine's switches does not.
                const blocked = !fit.ok && !p.config.engine;
                return (
                  <option key={p.name} value={p.name} disabled={blocked} title={fit.reasons[0]}>
                    {p.name}
                    {p.generated ? " (from lessons)" : p.builtIn ? "" : " (yours)"}
                    {p.name === defaultPreset ? " ★ default" : ""}
                    {blocked ? ` — needs ${ENGINE_LABEL[engineNow === "claude-code" ? "anthropic" : "claude-code"]}` : !fit.ok && p.config.engine ? ` — switches to ${ENGINE_LABEL[p.config.engine]}` : ""}
                  </option>
                );
              })}
            </select>
            {presetModified && <Badge tone="warn">modified</Badge>}
            {activePreset && activePreset.name !== defaultPreset && (
              <button className="btn btn-ghost btn-sm" onClick={() => makeDefault(activePreset.name)} title="Open New run with this preset from now on">
                Make default
              </button>
            )}
            {defaultPreset && activePreset?.name === defaultPreset && (
              <button className="btn btn-ghost btn-sm" onClick={() => makeDefault(null)} title="Start New run from the built-in defaults">
                Clear default
              </button>
            )}
            <span className="flex-1" />
            <button className="btn btn-ghost btn-sm" onClick={() => setShowChanges(!showChanges)} aria-expanded={showChanges} disabled={!changes.length}>
              {changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} from defaults` : "Defaults"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSaving(saving ? null : { name: cfg.preset && !activePreset?.builtIn ? cfg.preset : "", makeDefault: false })}>
              Save as preset…
            </button>
            <button className="btn btn-ghost btn-sm" onClick={resetToDefaults} disabled={!changes.length && !cfg.preset}>
              Reset to defaults
            </button>
          </div>
          {activePreset?.description && <div className="muted text-[11.5px] leading-snug">{activePreset.description}</div>}
          {notice && (
            <div className="text-[11.5px] leading-snug" role="status" data-preset-notice>
              <Badge tone="warn">note</Badge> {notice}
            </div>
          )}
          {activeFit?.adaptive && (
            <div className="muted text-[11.5px] leading-snug" data-preset-adapted>
              {activeFit.reasons[0].replace(/^Adapted/, "adapted")}
            </div>
          )}
          {engineNow === "claude-code" && (
            <div className="faint text-[11px] leading-snug">
              Unavailable on Claude Code: {presets.filter((p) => !p.config.engine && !presetCompatibility(p, "claude-code").ok).map((p) => p.name).join(", ") || "none"} (they turn on switches only Direct API honours).
            </div>
          )}
          {basis && basis.length > 0 && (
            <div className="text-[11.5px] leading-snug" data-preset-basis>
              <span className="font-semibold">Built from {basis.length} lesson{basis.length === 1 ? "" : "s"}:</span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {basis.map((b) => (
                  <li key={b.slug}>
                    <button type="button" className="underline" onClick={() => openLesson(b.slug)} title="Open this lesson">
                      {b.title}
                    </button>{" "}
                    <span className="muted">— {b.effect}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <GuidanceEditor lines={cfg.guidance ?? []} onChange={setGuidance} />
          {showChanges && changes.length > 0 && (
            <ul className="text-[11.5px] mono flex flex-col gap-0.5 fade-in">
              {changes.map((d) => (
                <li key={d.path}>{d.text}</li>
              ))}
            </ul>
          )}
          {saving && (
            <div className="flex flex-wrap items-center gap-2 fade-in">
              <input className="input" style={{ width: 220 }} autoFocus placeholder="Preset name" value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void savePreset()} aria-label="Preset name" />
              <label className="flex items-center gap-1.5 text-[12px]">
                <input type="checkbox" checked={saving.makeDefault} onChange={(e) => setSaving({ ...saving, makeDefault: e.target.checked })} /> make it my default
              </label>
              <button className="btn btn-sm btn-primary" disabled={!saving.name.trim()} onClick={() => void savePreset()}>
                Save
              </button>
              <span className="faint text-[11px]">Saves engine, switches, roles, pauses, context, guardrails and limits; never the task or folder.</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Model">
            <select className="input" value={cfg.roles.builder.model} onChange={(e) => setRole("builder", { model: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · ${m.inputPerM}/${m.outputPerM} per M
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effort">
            <select className="input" value={cfg.roles.builder.effort} onChange={(e) => setRole("builder", { effort: e.target.value as EffortLevel })}>
              {EFFORTS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Budget (USD)">
            <input className="input" type="number" min={1} step={1} value={cfg.budgetUsd} onChange={(e) => set({ budgetUsd: Math.max(0, Number(e.target.value) || 0) })} aria-invalid={!budgetOk} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["harness", "roles", "context", "guardrails"] as const).map((k) => (
            <button key={k} className={`btn btn-sm ${advanced === k ? "" : "btn-ghost"}`} onClick={() => setAdvanced(advanced === k ? null : k)}>
              {k === "harness" ? `Harness · ${Object.values(cfg.components).filter(Boolean).length}/${components.length} on` : k === "roles" ? "Roles & pauses" : k === "context" ? "Context policy" : `Guardrails · ${cfg.guardrail.mode}`}
            </button>
          ))}
        </div>

        {advanced === "harness" && (
          <div className="flex flex-col gap-3 fade-in">
            {[...new Set(components.map((c) => c.group))].map((g) => (
              <div key={g}>
                <div className="section-label mb-1.5">{GROUP_LABEL[g as HarnessComponent["group"]]}</div>
                <div className="grid md:grid-cols-2 gap-2">
                  {components
                    .filter((c) => c.group === g)
                    .map((c) => {
                      const ignored = liveEngine && !c.engines.includes(liveEngine);
                      const unmet = cfg.components[c.id] ? (c.requires ?? []).filter((r) => !cfg.components[r.id]) : [];
                      return (
                        <div key={c.id} className="rounded-lg border line p-2.5 flex gap-2 items-start">
                          <Switch checked={cfg.components[c.id]} onChange={() => toggle(c.id)} label={c.label} />
                          <div className="min-w-0">
                            <div className="font-medium text-[12.5px] flex flex-wrap items-center gap-1">
                              {c.label}
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
              <>Uses your Claude subscription; costs are shown as list-price estimates. The run stops at the budget (~{money(cfg.budgetUsd)} est.).</>
            ) : (
              <>
                Very rough estimate: <span className="mono">~{est}</span> (assumes a mid-sized task; real cost depends on the repo and effort). The run stops at the budget.
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
          <button className="btn" disabled={busy} onClick={() => start("replay")}>
            ▶ Watch demo instead
          </button>
          <button className="btn btn-primary" disabled={busy || !canStart} onClick={() => start("live")} title={!canStart ? "Enter a task, an existing folder, and pick an available engine" : undefined}>
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
