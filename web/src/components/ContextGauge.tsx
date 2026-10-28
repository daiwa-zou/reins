import React from "react";
import type { RunModel } from "../state/derive";
import { ROLE_LABEL } from "../state/derive";
import { tokens, pct } from "../lib/format";
import type { RoleId } from "@shared/types";

type PartKey = "system" | "tools" | "history" | "toolResults" | "thinking";
const PARTS: { key: PartKey; label: string; color: string }[] = [
  { key: "system", label: "System prompt", color: "var(--planner)" },
  { key: "tools", label: "Tool schemas", color: "var(--classifier)" },
  { key: "history", label: "Conversation", color: "var(--builder)" },
  { key: "toolResults", label: "Tool results", color: "var(--evaluator)" },
  { key: "thinking", label: "Thinking", color: "var(--fg-faint)" },
];

/**
 * The context window as a fuel gauge: the real prompt size from usage, with
 * an estimated composition, against the limit and against the harness's own
 * thresholds (clear, compact, reset). The point is to make the "attention
 * budget" visible at all times, not just when it runs out.
 */
export function ContextGauge({ model, role }: { model: RunModel; role: RoleId }) {
  const cfg = model.config;
  const snap = model.latestSnapshot[role];
  if (!snap) return <div className="muted text-[12px]">No model calls yet.</div>;
  const active = role;
  const compactAt = cfg?.components.compaction ? cfg.context.compactAtTokens : null;
  const resetAt = cfg?.components.resetWithHandoff ? cfg.context.resetAtTokens : null;
  const ceiling = Math.max(snap.limit, 1);
  const anxious = snap.promptTokens > 0.6 * (compactAt ?? snap.limit);
  const total = Math.max(1, snap.promptTokens);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px]">
          <span className={`font-semibold role-${active}`}>{ROLE_LABEL[active]}</span> <span className="muted">turn {snap.turn}</span>
        </span>
        <span className="mono text-[12px]">
          {tokens(snap.promptTokens)} <span className="muted">/ {tokens(snap.limit)}</span>
        </span>
      </div>
      <div className="relative h-3 rounded-full sunk overflow-hidden" title={`${pct(snap.promptTokens / ceiling)} of the window`}>
        <div className="absolute inset-y-0 left-0 flex" style={{ width: `${Math.min(100, (snap.promptTokens / ceiling) * 100)}%` }}>
          {PARTS.map((p) => (
            <div key={p.key} style={{ width: `${(snap.composition[p.key] / total) * 100}%`, background: p.color }} title={`${p.label}: ${tokens(snap.composition[p.key])}`} />
          ))}
        </div>
        {compactAt && <Marker at={compactAt / ceiling} label={`compaction at ${tokens(compactAt)}`} color="var(--warn)" />}
        {resetAt && <Marker at={resetAt / ceiling} label={`reset at ${tokens(resetAt)}`} color="var(--bad)" />}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] muted">
        {PARTS.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <span className="mono">{tokens(snap.composition[p.key])}</span>
          </span>
        ))}
        <span className="faint">composition is estimated; total is measured</span>
      </div>
      {anxious && compactAt && (
        <div className="text-[11px] text-[var(--warn)]">Approaching the compaction threshold. Watch for the agent wrapping up early ("context anxiety").</div>
      )}
    </div>
  );
}

function Marker({ at, label, color }: { at: number; label: string; color: string }) {
  if (at >= 1) return null;
  return <div className="absolute inset-y-0 w-px" style={{ left: `${at * 100}%`, background: color }} title={label} />;
}

/** Context growth over turns, with compaction/clear/reset markers. */
export function ContextHistory({ model, role }: { model: RunModel; role: RoleId }) {
  const snaps = model.snapshots.filter((s) => s.role === role);
  if (snaps.length < 2) return <div className="muted text-[12px]">Not enough turns yet to draw a history.</div>;
  const W = 640;
  const H = 120;
  const max = Math.max(...snaps.map((s) => s.promptTokens), model.config?.context.compactAtTokens ?? 0) * 1.1;
  const x = (i: number) => (i / (snaps.length - 1)) * (W - 20) + 10;
  const y = (v: number) => H - 10 - (v / max) * (H - 20);
  const layers = PARTS.map((p) => p.key);
  const stacks = snaps.map((s) => {
    let acc = 0;
    return layers.map((k) => {
      const y0 = acc;
      acc += s.composition[k];
      return [y0, acc] as [number, number];
    });
  });
  const compactAt = model.config?.components.compaction ? model.config.context.compactAtTokens : null;
  const marks = model.contextEvents.filter((e) => e.role === role);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[140px]" role="img" aria-label="Context size over turns">
      {layers.map((k, li) => (
        <path
          key={k}
          d={[...snaps.map((_, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(stacks[i][li][1])}`), ...snaps.map((_, i) => `L${x(snaps.length - 1 - i)},${y(stacks[snaps.length - 1 - i][li][0])}`), "Z"].join(" ")}
          fill={PARTS[li].color}
          opacity={0.85}
        />
      ))}
      {compactAt && compactAt < max && (
        <g>
          <line x1={10} x2={W - 10} y1={y(compactAt)} y2={y(compactAt)} stroke="var(--warn)" strokeDasharray="4 4" />
          <text x={W - 12} y={y(compactAt) - 3} fontSize="9" fill="var(--warn)" textAnchor="end">
            compaction {tokens(compactAt)}
          </text>
        </g>
      )}
      {marks.map((mk) => {
        const idx = Math.max(0, snaps.filter((s) => s.seq < mk.seq).length - 1);
        const px = x(idx);
        return (
          <g key={mk.seq}>
            <line x1={px} x2={px} y1={8} y2={H - 8} stroke={mk.what === "reset" ? "var(--bad)" : "var(--fg-muted)"} strokeWidth={1.5} />
            <text x={px + 3} y={14} fontSize="9" fill="var(--fg-muted)">
              {mk.what}
            </text>
          </g>
        );
      })}
      <text x={10} y={H - 1} fontSize="9" fill="var(--fg-faint)">
        turn 1
      </text>
      <text x={W - 10} y={H - 1} fontSize="9" fill="var(--fg-faint)" textAnchor="end">
        turn {snaps[snaps.length - 1].turn}
      </text>
    </svg>
  );
}
