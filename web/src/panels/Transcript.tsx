import React, { useMemo, useState } from "react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { ROLE_LABEL } from "../state/derive";
import { Badge, RoleChip, Empty } from "../components/ui";
import { CallRow } from "./Stage";
import { clock } from "../lib/format";
import type { RoleId, RunEvent, RunEventType } from "@shared/types";

const GROUPS: { id: string; label: string; types: RunEventType[] }[] = [
  { id: "tools", label: "Tool calls", types: ["tool.called"] },
  { id: "text", label: "Model text", types: ["text", "thinking"] },
  { id: "guard", label: "Guardrails", types: ["guardrail.decision", "approval.requested", "approval.resolved"] },
  { id: "context", label: "Context", types: ["context.snapshot", "context.compacted", "context.cleared", "context.reset", "tools.loaded"] },
  { id: "flow", label: "Phases & turns", types: ["phase.started", "phase.finished", "turn.started", "turn.finished", "run.status", "run.summary", "run.created"] },
  { id: "artifacts", label: "Contract, evaluation, progress", types: ["contract.proposed", "contract.agreed", "breakdown.agreed", "tests.agreed", "pr.opened", "pr.feedback", "pr.skipped", "pr.merged", "evaluation.result", "progress.updated", "git.commit", "files.changed"] },
  { id: "notes", label: "Notes & errors", types: ["note", "error", "steer.received", "steer.delivered"] },
];

/**
 * The flight recorder: every event, filterable, with a scrubber that rewinds
 * the whole UI to any point. "Read the transcripts" is the single most
 * repeated piece of advice in the evals and multi-agent posts.
 */
export function Transcript({ model }: { model: RunModel }) {
  const runId = useStore((s) => s.selectedRunId)!;
  const events = useStore((s) => s.events[runId] ?? []);
  const scrubSeq = useStore((s) => s.scrubSeq);
  const setScrub = useStore((s) => s.setScrub);
  // One kind of event at a time, or everything (context snapshots only when asked for); one role or all.
  const [group, setGroup] = useState<string>("all");
  const [role, setRole] = useState<RoleId | "all">("all");
  const [q, setQ] = useState("");

  const allowed = useMemo(() => new Set(GROUPS.filter((g) => (group === "all" ? g.id !== "context" : g.id === group)).flatMap((g) => g.types)), [group]);
  const shown = useMemo(() => {
    const upto = scrubSeq ?? Infinity;
    return events.filter((e) => e.seq <= upto && allowed.has(e.type) && (role === "all" || !("role" in e) || (e as any).role === role) && (!q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())));
  }, [events, allowed, role, q, scrubSeq]);

  if (!events.length) return <Empty title="No events yet" />;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b line flex flex-wrap items-center gap-2" style={{ background: "var(--bg-elev)" }}>
        <label className="text-small muted inline-flex items-center gap-1.5">
          Show
          <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Which events to show">
            <option value="all">Everything · {events.length}</option>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-small muted inline-flex items-center gap-1.5">
          Role
          <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={role} onChange={(e) => setRole(e.target.value as RoleId | "all")} aria-label="Which role's events to show">
            <option value="all">All roles</option>
            {(Object.keys(ROLE_LABEL) as RoleId[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <input className="input ml-auto" style={{ maxWidth: 240, padding: "4px 8px", fontSize: 12 }} type="search" placeholder="Search events" aria-label="Search events" value={q} onChange={(e) => setQ(e.target.value)} />
        {scrubSeq !== null && (
          <button className="btn btn-sm" onClick={() => setScrub(null)}>
            Back to live
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="max-w-4xl mx-auto flex flex-col gap-1">
          {shown.map((e) => (
            <EventRow key={e.seq} ev={e} model={model} />
          ))}
          <div className="muted text-[12px] text-center py-3">
            {shown.length} of {events.length} events
          </div>
        </div>
      </div>
    </div>
  );
}

function EventRow({ ev, model }: { ev: RunEvent; model: RunModel }) {
  const head = (
    <span className="flex items-center gap-2 text-[11px] shrink-0 w-[150px]">
      <span className="faint mono w-8 text-right">{ev.seq}</span>
      <span className="faint mono">{clock(ev.ts)}</span>
    </span>
  );
  const row = (children: React.ReactNode) => (
    <div className="flex gap-3 items-start py-0.5">
      {head}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
  switch (ev.type) {
    case "tool.called": {
      const call = model.calls.find((c) => c.toolUseId === ev.toolUseId);
      return row(call ? <CallRow call={call} /> : <span>{ev.narration}</span>);
    }
    case "text":
      return row(
        <div className="flex gap-2">
          <RoleChip role={ev.role} />
          <span className="whitespace-pre-wrap text-[12.5px]">{ev.text}</span>
        </div>,
      );
    case "thinking":
      return row(
        <div className="flex gap-2">
          <RoleChip role={ev.role} />
          <span className="whitespace-pre-wrap text-[12.5px] italic muted">{ev.text}</span>
        </div>,
      );
    case "guardrail.decision":
      return row(
        <span className="text-[12px]">
          <Badge tone={ev.verdict === "allow" ? "ok" : ev.verdict === "ask" ? "warn" : "bad"}>{ev.verdict}</Badge> <span className="mono">{ev.tool}</span> by {ev.source} · {ev.rule} — <span className="muted">{ev.rationale}</span>
        </span>,
      );
    case "context.snapshot":
      return row(
        <span className="text-[12px] muted">
          <RoleChip role={ev.snapshot.role} /> prompt {Math.round(ev.snapshot.promptTokens / 1000)}k tokens (turn {ev.snapshot.turn})
        </span>,
      );
    case "turn.finished":
      return row(
        <span className="text-[12px] muted">
          <RoleChip role={ev.role} /> turn {ev.turn} finished · {ev.stopReason} · in {ev.usage.input + ev.usage.cacheRead} / out {ev.usage.output} · ${ev.costUsd.toFixed(4)}
          {ev.fallbackModel && <Badge tone="warn">served by {ev.fallbackModel}</Badge>}
        </span>,
      );
    case "run.created":
      return row(<span className="text-[12px] muted">run created · {ev.config.roles.builder.model} · engine {ev.config.engine}</span>);
    default: {
      const { seq: _s, ts: _t, runId: _r, type, ...rest } = ev as any;
      const text = Object.entries(rest)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("  ");
      return row(
        <span className="text-[12px]">
          <span className="mono badge badge-neutral">{type}</span> <span className="muted break-all">{text.length > 400 ? text.slice(0, 400) + "…" : text}</span>
        </span>,
      );
    }
  }
}
