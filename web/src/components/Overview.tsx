import React from "react";
import { X } from "lucide-react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { Meter } from "./ui";
import { money, tokens } from "../lib/format";

/**
 * Overview rail: only what no other screen shows at a glance, namely progress
 * (features done, contract criteria passing) and budget. Phases live in the
 * stepper, the contract in its tab, changes in Changes and context in Details.
 */
export function Overview({ model }: { model: RunModel; live: RunModel }) {
  const setOverviewOpen = useStore((s) => s.setOverviewOpen);
  const navigate = useStore((s) => s.navigate);
  const cfg = model.config;
  if (!cfg) return null;
  const budget = cfg.budgetUsd;
  const spentFrac = budget ? model.costUsd / budget : 0;
  const done = model.features.filter((f) => f.status === "done").length;
  const latestEval = model.evaluations[model.evaluations.length - 1];
  const passing = latestEval ? latestEval.results.filter((r) => r.pass).length : 0;

  return (
    <aside aria-label="Overview" className="w-[264px] shrink-0 border-l line overflow-auto flex flex-col" style={{ background: "var(--bg-elev)" }}>
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="font-semibold text-small">Overview</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setOverviewOpen(false)} aria-label="Hide the overview" title="Hide the overview">
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="px-3 pb-3 flex flex-col gap-4">
        <section aria-labelledby="ov-progress">
          <h2 id="ov-progress" className="section-label mb-2">
            Progress
          </h2>
          <div className="flex items-baseline justify-between text-small mb-1">
            <span>Features</span>
            <span className="mono muted">
              {done}/{model.features.length}
            </span>
          </div>
          <Meter value={done} max={model.features.length} tone="ok" />
          {model.features.length > 0 ? (
            <ul className="flex flex-col gap-1 mt-2">
              {model.features.map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-small">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    aria-label={f.status.replace("_", " ")}
                    style={{ background: f.status === "done" ? "var(--ok)" : f.status === "in_progress" ? "var(--accent)" : f.status === "blocked" ? "var(--bad)" : "var(--line-strong)" }}
                  />
                  <span className={`truncate ${f.status === "done" ? "muted line-through" : ""}`} title={f.note ? `${f.title} — ${f.note}` : f.title}>
                    {f.title}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="faint text-small mt-1.5">The planner has not written a feature list yet.</div>
          )}

          <button type="button" className="w-full text-left mt-3 rounded-md hover:bg-[var(--bg-sunk)] -mx-1 px-1 py-0.5" onClick={() => navigate({ section: "runs", view: "contract" })} title="Open the Contract">
            <div className="flex items-baseline justify-between text-small mb-1">
              <span>Contract criteria passing</span>
              <span className="mono muted">{model.contract.length ? `${latestEval ? passing : "–"}/${model.contract.length}` : "–"}</span>
            </div>
            <Meter value={passing} max={Math.max(1, model.contract.length)} tone={latestEval && passing < model.contract.length ? "warn" : "ok"} />
            {!latestEval && <div className="faint text-small mt-1">{model.contract.length ? "Not evaluated yet." : "No contract yet."}</div>}
          </button>
        </section>

        <section aria-labelledby="ov-budget">
          <h2 id="ov-budget" className="section-label mb-2">
            Budget
          </h2>
          <div className="flex items-baseline justify-between text-small mb-1">
            <span>{Math.round(spentFrac * 100)}% used</span>
            <span className="muted">
              cap <span className="mono">{money(budget)}</span>
            </span>
          </div>
          <Meter value={model.costUsd} max={budget} tone={spentFrac > 0.9 ? "bad" : spentFrac > 0.7 ? "warn" : "accent"} />
          <div className="muted text-small mt-1.5">
            <span className="mono">{money(Math.max(0, budget - model.costUsd))}</span> left before the run stops
          </div>
          <div className="faint text-caption mono mt-2 flex gap-3" title="Uncached input / output / cache-read tokens">
            <span>in {tokens(model.usage.input)}</span>
            <span>out {tokens(model.usage.output)}</span>
            <span>cache {tokens(model.usage.cacheRead)}</span>
          </div>
        </section>
      </div>
    </aside>
  );
}
