import React, { useState } from "react";
import { CirclePlay, Plus, Trash2 } from "lucide-react";
import type { RunSummary } from "@shared/types";
import { useStore } from "../state/store";
import { StatusIcon, STATUS } from "./ui";
import { money, relTimeAt, basename } from "../lib/format";
import { useNow } from "../lib/useNow";
import { api } from "../lib/api";
import { PHASE_LABEL } from "../state/derive";
import { startDemo } from "../lib/demo";

const LIVE = ["running", "paused", "waiting_approval", "queued"];

/** The run list: a "Needs you" group first, then runs grouped by workspace. Rows stay one line. */
export function RunList() {
  const runs = useStore((s) => s.runs);
  const openModal = useStore((s) => s.openModal);
  const [filter, setFilter] = useState("");

  const q = filter.toLowerCase();
  const visible = runs.filter((r) => !q || r.title.toLowerCase().includes(q) || r.workspace.toLowerCase().includes(q) || r.status.includes(q));
  const rank = (s: string) => (s === "running" || s === "paused" || s === "queued" ? 0 : 1);
  const sorted = [...visible].sort((a, b) => rank(a.status) - rank(b.status) || (a.updatedAt < b.updatedAt ? 1 : -1));
  const needsYou = sorted.filter((r) => r.status === "waiting_approval");
  // Demo runs in their own group; group by full path so two "api" folders stay apart.
  const groups = new Map<string, { label: string; title: string; runs: RunSummary[] }>();
  for (const r of sorted) {
    if (r.status === "waiting_approval") continue;
    const key = r.engine === "replay" ? "\u0000demo" : r.workspace;
    const g = groups.get(key) ?? { label: r.engine === "replay" ? "Demo (recorded)" : basename(r.workspace), title: r.engine === "replay" ? "Recorded demo runs" : r.workspace, runs: [] };
    g.runs.push(r);
    groups.set(key, g);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2 pb-1.5">
        <input className="input text-small" placeholder="Filter runs…" aria-label="Filter runs" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: "4px 8px" }} />
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2">
        {runs.length === 0 && (
          <div className="muted text-small p-2 leading-relaxed">
            No runs yet.
            <div className="mt-2 flex flex-col gap-1.5">
              <button className="btn btn-sm" onClick={() => startDemo()}>
                <CirclePlay size={13} aria-hidden /> Watch the demo
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => openModal("newRun")}>
                <Plus size={13} aria-hidden /> New run
              </button>
            </div>
          </div>
        )}
        {runs.length > 0 && visible.length === 0 && <div className="faint text-small p-2">No runs match “{filter}”.</div>}
        {needsYou.length > 0 && (
          <Group label="Needs you" title="Runs waiting for your approval" tone="warn">
            {needsYou.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </Group>
        )}
        {[...groups.entries()].map(([key, g]) => (
          <Group key={key} label={g.label} title={g.title}>
            {g.runs.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </Group>
        ))}
      </div>
    </div>
  );
}

function Group({ label, title, tone, children }: { label: string; title: string; tone?: "warn"; children: React.ReactNode }) {
  return (
    <div className="mb-2" role="group" aria-label={label}>
      <div className="section-label px-2 pt-2 pb-1 truncate" title={title} style={tone ? { color: "var(--warn)" } : undefined}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ r }: { r: RunSummary }) {
  const selected = useStore((s) => s.selectedRunId === r.id && s.section === "runs");
  const selectRun = useStore((s) => s.selectRun);
  const toastMsg = useStore((s) => s.toastMsg);
  const live = LIVE.includes(r.status);
  // Relative times and a live row's age refresh on the shared clock (no interval of our own).
  const now = useNow(true);
  const relTime = (iso: string) => relTimeAt(iso, now);
  const tip = [r.title, `${STATUS[r.status].label}${r.phase ? ` · ${PHASE_LABEL[r.phase]}${r.round > 1 ? ` ${r.round}` : ""}` : ""}`, `${money(r.costUsd)} · ${r.workspace}`].join("\n");
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={() => selectRun(r.id)}
      onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), selectRun(r.id))}
      className="run-row group"
      title={tip}
    >
      <StatusIcon status={r.status} />
      <span className="flex-1 min-w-0 truncate text-small font-medium">{r.title}</span>
      <span className="text-caption faint shrink-0 group-hover:hidden group-focus-within:hidden">{relTime(r.updatedAt)}</span>
      {!live ? (
        <button
          type="button"
          aria-label={`Delete the log of ${r.title}`}
          title="Delete this run's log (the workspace is untouched)"
          className="hidden group-hover:inline-flex group-focus-within:inline-flex focus:inline-flex faint hover:text-[var(--bad)] rounded p-0.5 shrink-0"
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
      ) : (
        <span className="hidden group-hover:inline text-caption faint shrink-0">{relTime(r.updatedAt)}</span>
      )}
    </div>
  );
}
