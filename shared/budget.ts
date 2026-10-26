// The budget in the unit that is real for the engine. On the direct API engine
// usage is billed per token at list price, so a dollar budget is true. On the
// Claude Code engine usage counts against a Claude subscription, which is
// measured in tokens over a window, so the budget is tokens: input + output +
// cache writes, with cache reads counted at a tenth. Pure: server, web and tests.
import type { RunConfig, Usage } from "./types.js";
import { DEFAULT_COMPOSITION, EFFORT_TABLE, isEffort } from "./components.js";

export type Budget = { kind: "usd"; limit: number } | { kind: "tokens"; limit: number };

/** Tokens as a subscription window counts them. */
export function countedTokens(u: Usage): number {
  return u.input + u.output + u.cacheWrite + Math.floor(u.cacheRead / 10);
}

/** The active budget of a run: tokens on Claude Code (falling back to the effort table for runs that predate it), dollars otherwise. */
export function budgetOf(config: Pick<RunConfig, "engine" | "budgetUsd"> & Partial<Pick<RunConfig, "budgetTokens" | "effort">>): Budget {
  if (config.engine === "claude-code") {
    const limit = typeof config.budgetTokens === "number" && config.budgetTokens > 0 ? config.budgetTokens : EFFORT_TABLE[isEffort(config.effort) ? config.effort : DEFAULT_COMPOSITION.effort].budgetTokens;
    return { kind: "tokens", limit };
  }
  return { kind: "usd", limit: config.budgetUsd };
}

export const fmtTokens = (n: number) => Math.max(0, Math.round(n)).toLocaleString("en-US");

/** The "Budget and time" line every role gets in its first message. */
export function budgetLine(config: Parameters<typeof budgetOf>[0] & Pick<RunConfig, "maxTurnsPerPhase">, spent: { usd: number; tokens: number }, elapsedMin: number, maxTurns = config.maxTurnsPerPhase): string {
  const b = budgetOf(config);
  const head = b.kind === "usd" ? `$${Math.max(0, b.limit - spent.usd).toFixed(2)} of $${b.limit} remaining` : `${fmtTokens(b.limit - spent.tokens)} of ${fmtTokens(b.limit)} tokens remaining (usage counts against the Claude subscription; cache reads count a tenth)`;
  return `${head}; ${elapsedMin} minutes elapsed; at most ${maxTurns} turns in this phase. Pace yourself and leave the workspace clean if you must stop early.`;
}

export function budgetExhaustedMessage(config: Parameters<typeof budgetOf>[0]): string {
  const b = budgetOf(config);
  return b.kind === "usd" ? `Budget of $${b.limit} exhausted` : `Token budget of ${fmtTokens(b.limit)} exhausted (usage counts against the Claude subscription)`;
}
