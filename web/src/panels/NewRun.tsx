import React, { useEffect, useMemo, useState } from "react";
import { Modal, Switch, Badge } from "../components/ui";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { defaultRunConfig, MODELS } from "@shared/components";
import type { ComponentId, EffortLevel, RunConfig } from "@shared/types";

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

  const base = useMemo(
    () => defaultRunConfig({ task: "", workspace: info?.defaultWorkspace ?? "", engine: info?.hasApiKey ? "anthropic" : info?.hasClaudeCode ? "claude-code" : "anthropic", ...(prefill as any) }),
    [prefill, info],
  );
  const [cfg, setCfg] = useState<RunConfig>(base);
  const [recent, setRecent] = useState<string[]>([]);
  const [check, setCheck] = useState<{ exists: boolean; git: boolean; files: string[]; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState<null | "harness" | "roles" | "context" | "guardrails">(prefill ? "harness" : null);
  const [sameModel, setSameModel] = useState(true);

  useEffect(() => {
    api.workspaces().then((w) => setRecent(w.recent)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!cfg.workspace) return setCheck(null);
    const t = setTimeout(() => api.checkWorkspace(cfg.workspace).then(setCheck).catch(() => setCheck(null)), 250);
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

  const canStart = cfg.task.trim().length > 3 && !!check?.exists && (cfg.engine === "anthropic" ? !!info?.hasApiKey : !!info?.hasClaudeCode);
  const start = async (engine: "live" | "replay") => {
    setBusy(true);
    try {
      const created = engine === "replay" ? await api.demo() : await api.createRun({ ...cfg, title: cfg.title || cfg.task.slice(0, 60) });
      openModal(null);
      selectRun(created.id);
      useStore.getState().setTab("stage");
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const est = estimate(cfg);

  return (
    <Modal title={prefill ? "New run from these settings" : "New run"} onClose={() => openModal(null)} width={760}>
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
              <span className="faint">Type or pick a folder.</span>
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
              <button key={id} type="button" className={`flex-1 rounded-lg border p-2.5 text-left ${cfg.engine === id ? "border-[var(--accent)] sunk" : "line"}`} onClick={() => set({ engine: id })}>
                <div className="font-medium text-[12.5px] flex items-center gap-2">
                  {label}
                  {(id === "anthropic" ? info?.hasApiKey : info?.hasClaudeCode) ? <Badge tone="ok">ready</Badge> : <Badge tone="warn">unavailable</Badge>}
                </div>
                <div className="muted text-[11.5px] leading-snug">{desc}</div>
              </button>
            ))}
          </div>
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
            <input className="input" type="number" min={1} step={1} value={cfg.budgetUsd} onChange={(e) => set({ budgetUsd: Number(e.target.value) })} />
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
          <div className="grid md:grid-cols-2 gap-2 fade-in">
            {components.map((c) => (
              <div key={c.id} className="rounded-lg border line p-2.5 flex gap-2 items-start">
                <Switch checked={cfg.components[c.id]} onChange={() => toggle(c.id)} label={c.label} />
                <div className="min-w-0">
                  <div className="font-medium text-[12.5px]">{c.label}</div>
                  <div className="muted text-[11.5px] leading-snug">{c.short}</div>
                  <button className="text-[11px] underline muted mt-0.5" onClick={() => { openModal(null); setLessonFilter(c.lessons[0]); }}>
                    why
                  </button>
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Always ask (regex, one per line)">
                <textarea className="input mono" rows={3} value={cfg.guardrail.askPatterns.join("\n")} onChange={(e) => set({ guardrail: { ...cfg.guardrail, askPatterns: e.target.value.split("\n").filter(Boolean) } })} />
              </Field>
              <Field label="Always deny (regex, one per line)">
                <textarea className="input mono" rows={3} value={cfg.guardrail.denyPatterns.join("\n")} onChange={(e) => set({ guardrail: { ...cfg.guardrail, denyPatterns: e.target.value.split("\n").filter(Boolean) } })} />
              </Field>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t line">
          <div className="muted text-[12px] leading-snug">
            Rough estimate: <span className="mono">{est}</span>. Live runs stop at the budget.
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
  return `$${cost.toFixed(2)}–$${(cost * 3).toFixed(2)} · ${Math.round(turns)}–${Math.round(turns * 2.5)} model calls`;
}
