/**
 * Feed density: consecutive successful tool calls in one turn collapse into a
 * single "N tool calls" group. Pure (no React, no DOM) so it is unit-tested.
 *
 * Never hidden inside a group:
 *  - failed calls (result.ok === false),
 *  - calls a guardrail flagged (verdict "ask" or "deny") or a person decided,
 *  - calls still in flight (no result yet), so you always see what is running.
 * A lone successful call is shown as itself, not as a group of one.
 */

export interface GroupableCall {
  result?: { ok: boolean };
  guardrail?: { verdict: string; source?: string };
}

export type CallEntry<T> = { kind: "call"; call: T } | { kind: "group"; calls: T[] };

/** True when a call must always be visible on its own. */
export function isFlagged(c: GroupableCall): boolean {
  if (!c.result) return true;
  if (c.result.ok === false) return true;
  const g = c.guardrail;
  if (g && (g.verdict === "ask" || g.verdict === "deny" || g.source === "user")) return true;
  return false;
}

/**
 * Group a list of calls. `turnOf` tells which turn a call belongs to; calls
 * from different turns never merge (the default treats the list as one turn).
 */
export function groupCalls<T extends GroupableCall>(calls: readonly T[], turnOf: (c: T) => string | number = () => 0, minGroup = 2): CallEntry<T>[] {
  const out: CallEntry<T>[] = [];
  let run: T[] = [];
  let runTurn: string | number | undefined;
  const flush = () => {
    if (run.length >= Math.max(2, minGroup)) out.push({ kind: "group", calls: run });
    else for (const c of run) out.push({ kind: "call", call: c });
    run = [];
    runTurn = undefined;
  };
  for (const c of calls) {
    const turn = turnOf(c);
    if (isFlagged(c)) {
      flush();
      out.push({ kind: "call", call: c });
      continue;
    }
    if (run.length && turn !== runTurn) flush();
    run.push(c);
    runTurn = turn;
  }
  flush();
  return out;
}

/** "read_file ×3, bash ×2" for a group's summary line. */
export function summarizeNames(calls: readonly { name: string }[], max = 3): string {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
  return parts.length > max ? `${parts.slice(0, max).join(", ")}, …` : parts.join(", ");
}
