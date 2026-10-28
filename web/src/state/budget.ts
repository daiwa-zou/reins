// The run's budget as the UI shows it, in the engine's unit: tokens on Claude
// Code (usage counts against the subscription), dollars on the direct engine.
// Pure, shared by the run header and the Overview rail.
import type { RunConfig, Usage } from "@shared/types";
import { budgetOf, countedTokens } from "@shared/budget";
import { money, tokens } from "../lib/format";

export interface BudgetProgress {
  kind: "usd" | "tokens";
  spent: number;
  limit: number;
  /** spent / limit, clamped to 0..1 (0 when the limit is 0). */
  frac: number;
  /** Format a figure in the budget's unit, without the unit's name. */
  fmt: (n: number) => string;
  /** A tone for meters: bad past 90%, warn past 70%. */
  tone: "accent" | "warn" | "bad";
  /**
   * False for a Claude Code run that predates the token budget: its config records no cap, so the
   * `limit` is only the effort table's default and was never enforced on it. Show the spend, not a gauge.
   */
  recorded: boolean;
}

export function budgetProgress(cfg: RunConfig, model: { usage: Usage; costUsd: number }): BudgetProgress {
  const b = budgetOf(cfg);
  const spent = b.kind === "tokens" ? countedTokens(model.usage) : model.costUsd;
  const frac = b.limit ? Math.min(1, spent / b.limit) : 0;
  const recorded = b.kind === "usd" || typeof cfg.budgetTokens === "number";
  return { kind: b.kind, spent, limit: b.limit, frac, fmt: b.kind === "tokens" ? tokens : money, tone: frac > 0.9 ? "bad" : frac > 0.7 ? "warn" : "accent", recorded };
}
