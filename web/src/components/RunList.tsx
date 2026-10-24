import React, { useState } from "react";
import { useStore } from "../state/store";
import { StatusBadge } from "./ui";
import { money, relTime, basename } from "../lib/format";
import { api } from "../lib/api";
import { PHASE_LABEL } from "../state/derive";

export function RunList() {
  const runs = useStore((s) => s.runs);
  const selected = useStore((s) => s.selectedRunId);
  const selectRun = useStore((s) => s.selectRun);
  const openModal = useStore((s) => s.openModal);
  const toastMsg = useStore((s) => s.toastMsg);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState("");

  const visible = runs.filter((r) => !filter || r.title.toLowerCase().includes(filter.toLowerCase()) || r.workspace.toLowerCase().includes(filter.toLowerCase()));
  const groups = new Map<string, typeof runs>();
  for (const r of visible) {
    const key = basename(r.workspace);
    groups.set(key, [...(groups.get(key) ?? []), r]);
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
              <button className="btn btn-sm" onClick={() => api.demo().then((c) => selectRun(c.id)).catch((e) => toastMsg(e.message, "error"))}>
                ▶ Watch the demo
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => openModal("newRun")}>
                New run
              </button>
            </div>
          </div>
        )}
        {[...groups.entries()].map(([ws, list]) => (
          <div key={ws} className="mb-2">
            <div className="px-1.5 pt-2 pb-1 text-[10.5px] uppercase tracking-wider faint font-semibold truncate" title={list[0].workspace}>
              {ws}
            </div>
            {list.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRun(r.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-colors ${selected === r.id ? "sunk" : "hover:bg-[var(--bg-sunk)]"}`}
                style={selected === r.id ? { boxShadow: "inset 0 0 0 1px var(--line-strong)" } : undefined}
              >
                <div className="flex items-start justify-between gap-2 group">
                  <div className="font-medium text-[13px] leading-snug line-clamp-2">{r.title}</div>
                  {r.engine === "replay" && <span className="faint text-[10px] mt-0.5">demo</span>}
                  {!["running", "paused", "waiting_approval", "queued"].includes(r.status) && (
                    <span
                      role="button"
                      aria-label="Delete run"
                      title="Delete this run's log"
                      className="faint text-[11px] opacity-0 group-hover:opacity-100 hover:text-[var(--bad)] px-1"
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
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] muted">
                  <StatusBadge status={r.status} />
                  {r.phase && <span>{PHASE_LABEL[r.phase]}{r.round > 1 ? ` ${r.round}` : ""}</span>}
                  <span className="flex-1" />
                  <span className="mono">{money(r.costUsd)}</span>
                  <span>{relTime(r.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
