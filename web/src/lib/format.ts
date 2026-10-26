export function money(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

import { relTimeAt } from "./time";
export { relTimeAt };

/** Relative time against the current wall clock (static views). Live views pass useNow() to relTimeAt. */
export function relTime(iso: string): string {
  return relTimeAt(iso, Date.now());
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function tilde(p: string, home?: string): string {
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

/** "Title" -> "Title (2)" -> "Title (3)" so repeated runs stay distinguishable in the list. */
export function nextTitle(title: string): string {
  const m = title.match(/^(.*) \((\d+)\)$/);
  return m ? `${m[1]} (${Number(m[2]) + 1})` : `${title} (2)`;
}
