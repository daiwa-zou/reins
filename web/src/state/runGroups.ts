// The run list, read by urgency: what needs you, what is live, everything else.
// Pure, so vitest runs it in node.
import type { RunSummary } from "@shared/types";
import { PHASE_LABEL } from "./derive";
import { duration } from "../lib/format";
import { relTimeAt } from "../lib/time";

export interface RunGroup {
  id: "needs" | "live" | "earlier";
  label: string;
  runs: RunSummary[];
}

/** Live runs that are not waiting for you (those have their own group, first). */
const RUNNING = new Set<RunSummary["status"]>(["running", "paused", "queued"]);
const newestFirst = (a: RunSummary, b: RunSummary) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

/** Needs you, then Running, then Earlier, each newest first; empty groups are left out. */
export function groupRuns(runs: RunSummary[]): RunGroup[] {
  const needs = runs.filter((r) => r.status === "waiting_approval").sort(newestFirst);
  const live = runs.filter((r) => RUNNING.has(r.status)).sort(newestFirst);
  const earlier = runs.filter((r) => r.status !== "waiting_approval" && !RUNNING.has(r.status)).sort(newestFirst);
  return [
    { id: "needs" as const, label: "Needs you", runs: needs },
    { id: "live" as const, label: "Running", runs: live },
    { id: "earlier" as const, label: "Earlier", runs: earlier },
  ].filter((g) => g.runs.length);
}

/** "Build P2 of 3", "Evaluate · round 2", "Contract". */
function where(r: RunSummary): string {
  if (!r.phase) return "";
  const phase = PHASE_LABEL[r.phase];
  if (r.package) return `${phase} ${r.package.id} of ${r.package.total}`;
  return r.round > 1 ? `${phase} · round ${r.round}` : phase;
}

/** One line under a run's title: where it is now, or how it ended and when. */
export function runContextLine(r: RunSummary, now: number): string {
  const elapsed = duration(Math.max(0, now - Date.parse(r.createdAt)));
  const since = relTimeAt(r.updatedAt, now);
  switch (r.status) {
    case "running":
      return [where(r), elapsed].filter(Boolean).join(" · ");
    case "paused":
      return [`Paused${r.phase ? ` in ${PHASE_LABEL[r.phase]}` : ""}`, elapsed].join(" · ");
    case "queued":
      return "Queued";
    case "waiting_approval":
      return ["Waiting for you", where(r), since].filter(Boolean).join(" · ");
    case "completed":
      return ["Completed", r.engine === "replay" ? "demo" : "", since].filter(Boolean).join(" · ");
    case "failed":
      return [`Failed${r.phase ? ` in ${PHASE_LABEL[r.phase]}` : ""}`, since].join(" · ");
    case "cancelled":
      return [`Stopped${r.phase ? ` in ${PHASE_LABEL[r.phase]}` : ""}`, since].join(" · ");
  }
}
