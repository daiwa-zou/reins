// Pure time helpers for the live Runs page. No React and no timers here: the
// one shared clock lives in useNow.ts, and every ticking value is computed by
// these functions from (start, end, now), so they are easy to test.

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/** A finished item's duration in ms: end - start, never negative. Undefined when either end is missing. */
export function finishedDuration(startTs: string | undefined, endTs: string | undefined): number | undefined {
  const s = ms(startTs);
  const e = ms(endTs);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined;
  return Math.max(0, e - s);
}

export interface LiveOpts {
  /** Is the run still live? When false, an unfinished item is frozen instead of growing. Default true. */
  live?: boolean;
  /** Last known event time of the run; a frozen unfinished item shows lastTs - start. */
  lastTs?: string;
}

/**
 * Elapsed ms for an item that may still be running.
 * - finished (endTs set): fixed end - start, whatever `now` is;
 * - pending in a live run: grows with `now`;
 * - left unfinished in a run that ended (failed, cancelled...): frozen at the
 *   run's last known time, or undefined (shown as '–') when that is unknown.
 */
export function liveElapsed(startTs: string | undefined, endTs: string | undefined, now: number, opts: LiveOpts = {}): number | undefined {
  if (endTs) return finishedDuration(startTs, endTs);
  const s = ms(startTs);
  if (!Number.isFinite(s)) return undefined;
  if (opts.live === false) return opts.lastTs ? finishedDuration(startTs, opts.lastTs) : undefined;
  return Math.max(0, now - s);
}

/**
 * The run's elapsed time for the header and end card. A finished run shows
 * summary.durationMs, falling back to lastTs - startedTs; a live run ticks.
 */
export function runElapsed(m: { startedTs?: string; lastTs?: string; summary?: { durationMs: number } }, now: number, live: boolean): number {
  if (!live) return m.summary?.durationMs ?? finishedDuration(m.startedTs, m.lastTs) ?? 0;
  return liveElapsed(m.startedTs, undefined, now) ?? 0;
}

/** "2m ago" style relative time against an explicit clock. */
export function relTimeAt(iso: string, now: number): string {
  const d = now - Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
