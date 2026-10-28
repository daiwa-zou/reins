import React, { useState } from "react";
import { CirclePlay, Plus, Trash2 } from "lucide-react";
import type { RunSummary } from "@shared/types";
import { useStore } from "../state/store";
import { Kbd, STATUS } from "./ui";
import { useNow } from "../lib/useNow";
import { api } from "../lib/api";
import { startDemo } from "../lib/demo";
import { groupRuns, runContextLine } from "../state/runGroups";
import { isLive } from "../state/derive";

/** The Runs column: a title, New run, a filter, then the runs by urgency (Needs you, Running, Earlier), two lines each. */
export function RunList() {
  const runs = useStore((s) => s.runs);
  const openModal = useStore((s) => s.openModal);
  const [filter, setFilter] = useState("");
  const q = filter.toLowerCase();
  const visible = runs.filter((r) => !q || r.title.toLowerCase().includes(q) || r.workspace.toLowerCase().includes(q) || r.status.includes(q));
  const groups = groupRuns(visible);

  return (
    <aside aria-label="Runs" className="w-[272px] shrink-0 border-r line flex flex-col min-h-0" style={{ background: "var(--bg-elev)" }}>
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <h1 className="text-title font-semibold flex-1 m-0">Runs</h1>
        <button className="btn btn-primary btn-sm" onClick={() => openModal("newRun")} title="Start a new run (n)">
          <Plus size={13} aria-hidden /> New run <Kbd>n</Kbd>
        </button>
      </div>
      <div className="px-3.5 pb-2">
        <input className="input text-small" type="search" placeholder="Filter runs" aria-label="Filter runs" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: "5px 9px" }} />
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2">
        {runs.length === 0 && (
          <div className="muted text-small p-2 leading-relaxed">
            No runs yet.
            <div className="mt-2 flex flex-col gap-1.5">
              <button className="btn btn-sm" onClick={() => startDemo()}>
                <CirclePlay size={13} aria-hidden /> Watch the demo
              </button>
            </div>
          </div>
        )}
        {runs.length > 0 && visible.length === 0 && <div className="faint text-small p-2">No runs match “{filter}”.</div>}
        {groups.map((g) => (
          <div key={g.id} className="mb-1" role="group" aria-label={g.label}>
            <div className="section-label px-2 pt-2.5 pb-1" style={g.id === "needs" ? { color: "var(--warn)" } : undefined}>
              {g.label} · {g.runs.length}
            </div>
            {g.runs.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function Row({ r }: { r: RunSummary }) {
  const selected = useStore((s) => s.selectedRunId === r.id && s.section === "runs");
  const selectRun = useStore((s) => s.selectRun);
  const toastMsg = useStore((s) => s.toastMsg);
  const live = isLive(r.status);
  const now = useNow(true);
  const m = STATUS[r.status];
  const dot = m.tone === "neutral" ? "var(--fg-faint)" : `var(--${m.tone})`;
  return (
    <div role="button" tabIndex={0} aria-current={selected ? "true" : undefined} onClick={() => selectRun(r.id)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), selectRun(r.id))} className="run-row group" title={`${r.title}\n${m.label} · ${r.workspace}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 mt-[6px] ${m.pulse ? "pulse" : ""}`} style={{ background: dot }} aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-small font-medium">{r.title}</span>
        <span className="block truncate text-caption faint mt-0.5">{runContextLine(r, now)}</span>
      </span>
      {!live && (
        <button
          type="button"
          aria-label={`Delete the log of ${r.title}`}
          title="Delete this run's log (the workspace is untouched)"
          className="hidden group-hover:inline-flex group-focus-within:inline-flex focus:inline-flex faint hover:text-[var(--bad)] rounded p-0.5 shrink-0 mt-0.5"
          onClick={(e) => {
            e.stopPropagation();
            if (!confirm(`Delete the log of "${r.title}"? The workspace is untouched.`)) return;
            const wasSelected = useStore.getState().selectedRunId === r.id;
            api
              .deleteRun(r.id)
              .then(() => wasSelected && selectRun(null, { replace: true }))
              .catch((err) => toastMsg(err.message, "error"));
          }}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}
