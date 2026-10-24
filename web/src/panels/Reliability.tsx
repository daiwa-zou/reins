import React, { useEffect, useState } from "react";
import { Badge, Empty } from "../components/ui";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { money, duration, relTime, pct, tilde } from "../lib/format";
import type { TrialSet } from "@shared/types";

/**
 * One green run proves little. The reliability lab groups runs of the same
 * task into trial sets and shows pass^k (consistency) next to pass@k.
 */
export function ReliabilityPanel() {
  const [sets, setSets] = useState<TrialSet[] | null>(null);
  const [k, setK] = useState(3);
  const runs = useStore((s) => s.runs);
  const info = useStore((s) => s.info);
  const selectRun = useStore((s) => s.selectRun);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const toastMsg = useStore((s) => s.toastMsg);

  const runsKey = runs.map((r) => r.id + r.status).join(",");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .trials(k)
      .then((s) => {
        setSets(s);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [k, runsKey]);

  const repeat = (set: TrialSet, n: number) => {
    const budget = runs.find((r) => r.id === set.trials[0].runId);
    if (!confirm(`Queue ${n} more live trials of this task? They run one after another, each stopping at the run's budget.${budget ? "" : ""}`)) return;
    api.repeat(set.trials[0].runId, n).then(() => toastMsg(`Queued ${n} more trials; they run one after another.`)).catch((e) => toastMsg(e.message, "error"));
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="text-[16px] font-semibold tracking-tight flex-1">A single green run proves little.</div>
            <label className="text-[12px] muted flex items-center gap-2">
              k =
              <select className="input" style={{ width: 64, padding: "3px 6px" }} value={k} onChange={(e) => setK(Number(e.target.value))}>
                {[2, 3, 5, 10].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted mt-1 leading-relaxed text-[12.5px]">
            Runs of the same task in the same workspace form a trial set. <b>pass^k</b> is the chance that all k attempts succeed (what you need from an agent you rely on);{" "}
            <b>pass@k</b> is the chance that at least one does (what a leaderboard shows). Both are projected from the observed pass rate, so three trials are a start, not a verdict. Runs stopped by you or by a server restart are not counted.{" "}
            <button className="underline" onClick={() => setLessonFilter("demystifying-evals-for-ai-agents")}>
              Read the lesson →
            </button>
          </p>
        </div>

        {error ? (
          <div className="rounded-lg p-3 text-[12.5px]" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
            Could not load trials: {error}
          </div>
        ) : sets === null ? (
          <div className="muted">Loading…</div>
        ) : sets.length === 0 ? (
          <Empty title="No trial sets yet" body="Live runs (not the demo) appear here. Use “Run again” on a finished run, or “Run 3 more” below, to build a set." />
        ) : (
          sets.map((set) => (
            <div key={set.key} className="card overflow-hidden">
              <div className="p-4 flex items-start gap-4 border-b line">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold leading-snug line-clamp-2">{set.task}</div>
                  <div className="muted text-[11.5px] mt-0.5 truncate">{tilde(set.workspace, info?.home)}</div>
                </div>
                <Stat label="pass rate" value={set.n ? pct(set.passRate) : "—"} sub={`${set.passes}/${set.n} finished`} />
                {set.n >= set.k ? (
                  <>
                    <Stat label={`pass^${set.k}`} value={pct(set.passPowK)} tone={set.passPowK >= 0.8 ? "ok" : set.passPowK >= 0.5 ? "warn" : "bad"} />
                    <Stat label={`pass@${set.k}`} value={pct(set.passAtK)} />
                  </>
                ) : (
                  <Stat label={`pass^${set.k}`} value="n/a" sub={`needs ${set.k - set.n} more finished trial(s)`} />
                )}
                <button className="btn btn-sm" onClick={() => repeat(set, 3)} disabled={set.trials.some((t) => t.status === "running" || t.status === "waiting_approval")} title="Queues three identical live runs, one after another">
                  Run 3 more
                </button>
              </div>
              <div className="flex gap-0.5 px-4 pt-3">
                {set.trials
                  .slice()
                  .reverse()
                  .map((t) => (
                    <div key={t.runId} className="h-2 flex-1 rounded-sm" title={`${t.verdict} · ${t.status}`} style={{ background: t.status === "completed" && t.verdict === "pass" ? "var(--ok)" : t.status === "failed" || t.verdict === "fail" ? "var(--bad)" : "var(--line-strong)" }} />
                  ))}
              </div>
              <table className="w-full text-[12.5px] mt-2">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider faint">
                    <th className="px-4 py-1.5">trial</th>
                    <th className="px-3 py-1.5">outcome</th>
                    <th className="px-3 py-1.5">fix rounds</th>
                    <th className="px-3 py-1.5">cost</th>
                    <th className="px-3 py-1.5">time</th>
                    <th className="px-3 py-1.5">model · engine</th>
                    <th className="px-3 py-1.5">when</th>
                  </tr>
                </thead>
                <tbody>
                  {set.trials.map((t) => (
                    <tr key={t.runId} className="border-t line hover:bg-[var(--bg-sunk)] cursor-pointer" onClick={() => selectRun(t.runId, { view: "activity" })}>
                      <td className="px-4 py-1.5 mono faint">{t.runId}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={t.status === "completed" && t.verdict === "pass" ? "ok" : t.status === "failed" || t.verdict === "fail" ? "bad" : "neutral"}>{t.status === "completed" ? t.verdict : t.status}</Badge>
                      </td>
                      <td className="px-3 py-1.5 mono">{t.fixRounds}</td>
                      <td className="px-3 py-1.5 mono">{money(t.costUsd)}</td>
                      <td className="px-3 py-1.5 mono">{duration(t.durationMs)}</td>
                      <td className="px-3 py-1.5 muted truncate max-w-[220px]">
                        {t.model} · {t.engine}
                        {t.harnessVersion && <span className="faint"> · reins {t.harnessVersion}</span>}
                      </td>
                      <td className="px-3 py-1.5 muted">{relTime(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="text-right">
      <div className="text-[10.5px] uppercase tracking-wider faint font-semibold">{label}</div>
      <div className={`text-[17px] font-semibold mono ${tone ? `text-[var(--${tone})]` : ""}`}>{value}</div>
      {sub && <div className="muted text-[11px]">{sub}</div>}
    </div>
  );
}
