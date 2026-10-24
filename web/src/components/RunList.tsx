import React, { useState } from "react";
import { useStore } from "../state/store";
import { StatusBadge } from "./ui";
import { money, relTime, basename } from "../lib/format";
import { api } from "../lib/api";
import { PHASE_LABEL } from "../state/derive";
import { startDemo } from "../lib/demo";

export function RunList() {
  const runs = useStore((s) => s.runs);
  const selected = useStore((s) => s.selectedRunId);
  const selectRun = useStore((s) => s.selectRun);
  const openModal = useStore((s) => s.openModal);
  const toastMsg = useStore((s) => s.toastMsg);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState("");

  const q = filter.toLowerCase();
  const visible = runs.filter((r) => !q || r.title.toLowerCase().includes(q) || r.workspace.toLowerCase().includes(q) || r.status.includes(q));
  const rank = (s: string) => (s === "waiting_approval" ? 0 : s === "running" || s === "paused" || s === "queued" ? 1 : 2);
  // Attention first, then recency; demo runs in their own group; group by full path so two "api" folders stay apart.
  const groups = new Map<string, { label: string; runs: typeof runs }>();
  for (const r of [...visible].sort((a, b) => rank(a.status) - rank(b.status) || (a.updatedAt < b.updatedAt ? 1 : -1))) {
    const key = r.engine === "replay" ? "\u0000demo" : r.workspace;
    const g = groups.get(key) ?? { label: r.engine === "replay" ? "Demo (recorded)" : basename(r.workspace), runs: [] };
    g.runs.push(r);
    groups.set(key, g);
  }

  if (collapsed)
    return (
      <aside className="w-10 border-r line flex flex-col items-center py-2 gap-2" style={{ background: "var(--bg-elev)" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setCollapsed(false)} title="Show runs">
          ☰
        </button>
        <div className="mono text-[11px] muted" style={{ writingMode: "vertical-rl" }}>
          {runs.length} runs
        </div>
      </aside>
    );

  return (
    <aside className="w-[240px] xl:w-[260px] shrink-0 border-r line flex flex-col" style={{ background: "var(--bg-elev)" }}>
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <input className="input" placeholder="Filter runs…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setCollapsed(true)} title="Hide runs">
          ‹
        </button>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2">
        {runs.length === 0 && (
          <div className="muted text-[12px] p-3 leading-relaxed">
            No runs yet.
            <div className="mt-2 flex flex-col gap-1.5">
              <button className="btn btn-sm" onClick={() => startDemo()}>
                ▶ Watch the demo
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => openModal("newRun")}>
                New run
              </button>
            </div>
          </div>
        )}
        {[...groups.entries()].map(([ws, { label, runs: list }]) => (
          <div key={ws} className="mb-2">
            <div className="px-1.5 pt-2 pb-1 text-[10.5px] uppercase tracking-wider faint font-semibold truncate" title={list[0].workspace}>
              {label}
            </div>
            {list.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                aria-current={selected === r.id ? "true" : undefined}
                onClick={() => selectRun(r.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), selectRun(r.id))}
                className={`w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-colors cursor-pointer ${selected === r.id ? "sunk" : "hover:bg-[var(--bg-sunk)]"}`}
                style={selected === r.id ? { boxShadow: "inset 0 0 0 1px var(--line-strong)" } : undefined}
              >
                <div className="flex items-start justify-between gap-2 group">
                  <div className="font-medium text-[13px] leading-snug line-clamp-2">{r.title}</div>
                  {r.engine === "replay" && <span className="badge badge-neutral">demo</span>}
                  {!["running", "paused", "waiting_approval", "queued"].includes(r.status) && (
                    <button
                      type="button"
                      aria-label={`Delete the log of ${r.title}`}
                      title="Delete this run's log (the workspace is untouched)"
                      className="faint text-[11px] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[var(--bad)] px-1 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete the log of "${r.title}"? The workspace is untouched.`)) return;
                        api
                          .deleteRun(r.id)
                          .then(() => selected === r.id && selectRun(null))
                          .catch((err) => toastMsg(err.message, "error"));
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] muted">
                  <StatusBadge status={r.status} />
                  {r.phase && <span>{PHASE_LABEL[r.phase]}{r.round > 1 ? ` ${r.round}` : ""}</span>}
                  <span className="flex-1" />
                  <span className="mono">{money(r.costUsd)}</span>
                  <span>{relTime(r.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
