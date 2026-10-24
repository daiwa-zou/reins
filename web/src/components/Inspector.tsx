import React from "react";
import type { RunModel } from "../state/derive";
import { PHASE_LABEL, ROLE_LABEL } from "../state/derive";
import { useStore } from "../state/store";
import { Meter, RoleDot } from "./ui";
import { ContextGauge } from "./ContextGauge";
import { money, tokens, duration } from "../lib/format";
import type { RoleId } from "@shared/types";

/** Right rail: the always-visible vitals of the selected run. */
export function Inspector({ model, live }: { model: RunModel; live: RunModel }) {
  const setTab = useStore((s) => s.setTab);
  const cfg = model.config;
  if (!cfg) return null;
  const budget = cfg.budgetUsd;
  const spentFrac = budget ? model.costUsd / budget : 0;
  const done = model.features.filter((f) => f.status === "done").length;
  const roles: RoleId[] = ["planner", "builder", "evaluator", ...(model.turnsByRole.scout ? (["scout"] as RoleId[]) : [])];
  const latestEval = model.evaluations[model.evaluations.length - 1];

  return (
    <aside className="w-[300px] shrink-0 border-l line overflow-auto p-3 hidden lg:flex flex-col gap-3" style={{ background: "var(--bg-elev)" }}>
      <Section title="Budget" onClick={() => setTab("harness")}>
        <div className="flex items-baseline justify-between">
          <span className="text-[18px] font-semibold mono">{money(model.costUsd)}</span>
          <span className="muted text-[12px]">of {money(budget)}</span>
        </div>
        <Meter value={model.costUsd} max={budget} tone={spentFrac > 0.9 ? "bad" : spentFrac > 0.7 ? "warn" : "accent"} />
        <div className="grid grid-cols-3 gap-1 mt-2 text-[11px] muted mono">
          <div title="Uncached input tokens">in {tokens(model.usage.input)}</div>
          <div title="Output tokens">out {tokens(model.usage.output)}</div>
          <div title="Cache reads">cache {tokens(model.usage.cacheRead)}</div>
        </div>
        {model.usage.input + model.usage.cacheRead > 0 && (
          <div className="text-[11px] muted mt-1" title="Share of prompt tokens served from the cache. A low number means something is invalidating the prefix.">
            cache hit {Math.round((model.usage.cacheRead / (model.usage.input + model.usage.cacheRead + model.usage.cacheWrite)) * 100)}%
          </div>
        )}
      </Section>

      <Section title="Context" onClick={() => setTab("context")}>
        <ContextGauge model={model} compact />
      </Section>

      <Section title="Phases" onClick={() => setTab("stage")}>
        <div className="flex flex-col gap-1">
          {model.phases.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span className={`w-1.5 h-1.5 rounded-full ${p.finishedTs ? "bg-[var(--ok)]" : "bg-[var(--accent)] pulse"}`} />
              <span className="flex-1 truncate">
                {PHASE_LABEL[p.phase]}
                {p.round > 1 ? ` · round ${p.round}` : ""}
              </span>
              <span className="muted mono">{p.turns}t</span>
              <span className="muted mono w-14 text-right">{money(p.costUsd)}</span>
              <span className="muted mono w-12 text-right">{p.finishedTs ? duration(Date.parse(p.finishedTs) - Date.parse(p.startedTs)) : "…"}</span>
            </div>
          ))}
          {model.phases.length === 0 && <div className="muted text-[12px]">Not started.</div>}
        </div>
      </Section>

      <Section title="Roles">
        <div className="flex flex-col gap-1 text-[12px]">
          {roles.map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RoleDot role={r} />
              <span className="flex-1">{ROLE_LABEL[r]}</span>
              <span className="muted mono">{model.turnsByRole[r] ?? 0} turns</span>
              <span className="muted mono w-14 text-right">{money(model.costByRole[r] ?? 0)}</span>
            </div>
          ))}
          <div className="faint text-[11px] mt-1 truncate" title={cfg.roles.builder.model}>
            {cfg.roles.builder.model} · effort {cfg.roles.builder.effort}
          </div>
        </div>
      </Section>

      {model.contract.length > 0 && (
        <Section title="Contract" onClick={() => setTab("contract")}>
          <div className="flex flex-col gap-1">
            {model.contract.map((c) => {
              const r = latestEval?.results.find((x) => x.id === c.id);
              return (
                <div key={c.id} className="flex items-start gap-2 text-[12px]">
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded-sm shrink-0 flex items-center justify-center text-[10px] font-bold ${r ? (r.pass ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--bad-soft)] text-[var(--bad)]") : "sunk faint"}`}>
                    {r ? (r.pass ? "✓" : "✕") : ""}
                  </span>
                  <span className="truncate" title={c.text}>
                    {c.text}
                  </span>
                  {c.hard && <span className="faint text-[10px] shrink-0">hard</span>}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {model.features.length > 0 && (
        <Section title={`Features · ${done}/${model.features.length}`}>
          <Meter value={done} max={model.features.length} tone="ok" />
          <div className="flex flex-col gap-1 mt-2">
            {model.features.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-[12px]">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: f.status === "done" ? "var(--ok)" : f.status === "in_progress" ? "var(--accent)" : f.status === "blocked" ? "var(--bad)" : "var(--line-strong)" }}
                />
                <span className={`truncate ${f.status === "done" ? "muted line-through" : ""}`} title={f.note ? `${f.title} — ${f.note}` : f.title}>
                  {f.title}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(model.commits.length > 0 || model.files.length > 0) && (
        <Section title="Changes" onClick={() => setTab("files")}>
          <div className="text-[12px] muted">
            {model.files.length} files · +{model.files.reduce((a, f) => a + f.additions, 0)} −{model.files.reduce((a, f) => a + f.deletions, 0)}
          </div>
          {model.commits.map((c) => (
            <div key={c.sha} className="text-[12px] truncate mt-1" title={c.message}>
              <span className="mono muted">{c.sha}</span> {c.message}
            </div>
          ))}
        </Section>
      )}

      {live.toolsLoaded.length > 0 && (
        <Section title="Tools loaded on demand">
          <div className="flex flex-wrap gap-1">
            {live.toolsLoaded.map((t) => (
              <span key={t} className="badge badge-neutral mono">
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children, onClick }: { title: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <section>
      {onClick ? (
        <button type="button" className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-1.5 cursor-pointer hover:text-[var(--fg)] rounded" onClick={onClick}>
          {title}
          <span className="ml-1">›</span>
        </button>
      ) : (
        <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-1.5">{title}</div>
      )}
      {children}
    </section>
  );
}
