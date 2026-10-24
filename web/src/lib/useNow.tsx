// The one clock of the web UI. Every ticking value (run header, pending tool
// calls, active turn and phase, run list relative times) subscribes here, so
// there is a single setInterval for the whole app. It runs only while at least
// one subscriber is enabled and the tab is visible.
import React, { createContext, useContext, useSyncExternalStore } from "react";
import { liveElapsed } from "./time";
import { duration } from "./format";

const TICK_MS = 1000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

function tick() {
  now = Date.now();
  for (const l of listeners) l();
}

function sync() {
  const want = listeners.size > 0 && visible();
  if (want && !timer) {
    tick(); // catch up immediately after being hidden or idle
    timer = setInterval(tick, TICK_MS);
  } else if (!want && timer) {
    clearInterval(timer);
    timer = null;
  }
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", sync);

function subscribe(l: () => void) {
  listeners.add(l);
  sync();
  return () => {
    listeners.delete(l);
    sync();
  };
}

const noop = () => () => {};

/**
 * Current time in ms, re-rendering about once a second while `enabled`.
 * Disabled: no subscription (and the interval stops when nobody else needs it);
 * the value is the time of the last tick.
 */
export function useNow(enabled = true): number {
  return useSyncExternalStore(
    enabled ? subscribe : noop,
    () => now,
    () => now,
  );
}

/** Whether rows below should tick: true only for a live run that is not being scrubbed. */
export interface RunClock {
  live: boolean;
  lastTs?: string;
}
const RunClockContext = createContext<RunClock>({ live: false });
export const RunClockProvider = RunClockContext.Provider;
export const useRunClock = () => useContext(RunClockContext);

/** Elapsed time of one item (call, turn, phase): ticks while pending in a live run, fixed once it ends. */
export function Elapsed({ start, end, fixedMs, className, title }: { start?: string; end?: string; fixedMs?: number; className?: string; title?: string }) {
  const clock = useRunClock();
  const pending = fixedMs === undefined && !end;
  const t = useNow(pending && clock.live);
  const ms = fixedMs ?? liveElapsed(start, end, t, { live: clock.live, lastTs: clock.lastTs });
  return (
    <span className={className ?? "faint mono text-caption"} title={title} data-elapsed={pending && clock.live ? "live" : "fixed"}>
      {ms === undefined ? "–" : duration(ms)}
    </span>
  );
}
