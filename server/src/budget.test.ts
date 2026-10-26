import { describe, expect, it } from "vitest";
import { budgetExhaustedMessage, budgetLine, budgetOf, countedTokens } from "../../shared/budget.js";
import { defaultRunConfig, EFFORT_LEVELS, EFFORT_TABLE } from "../../shared/components.js";
import { applyPreset, checkRunConfig, validatePresetConfig } from "../../shared/config.js";

// On the direct API engine usage is billed per token, so a dollar budget is real.
// On Claude Code usage counts against a subscription measured in tokens over a
// window, so the budget is tokens: input + output + cache writes, cache reads at a tenth.

describe("the budget in the engine's unit", () => {
  it("the effort table carries a token budget next to the dollar one, scaled the same way", () => {
    expect(EFFORT_LEVELS.map((e) => EFFORT_TABLE[e].budgetTokens)).toEqual([300_000, 1_000_000, 2_000_000, 4_000_000]);
    expect(defaultRunConfig({ task: "t", workspace: "/w" }).budgetTokens).toBe(1_000_000);
  });

  it("counts tokens the way a subscription window does: cache reads at a tenth", () => {
    expect(countedTokens({ input: 1000, output: 200, cacheRead: 5000, cacheWrite: 300 })).toBe(2000);
    expect(countedTokens({ input: 0, output: 0, cacheRead: 9, cacheWrite: 0 })).toBe(0);
  });

  it("budgetOf picks dollars on the direct engine and tokens on Claude Code, with a fallback for runs that predate the token budget", () => {
    expect(budgetOf(defaultRunConfig({ task: "t", workspace: "/w", engine: "anthropic", budgetUsd: 7 }))).toEqual({ kind: "usd", limit: 7 });
    expect(budgetOf(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code", budgetTokens: 250_000 }))).toEqual({ kind: "tokens", limit: 250_000 });
    const old = { ...defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code", effort: "high" }), budgetTokens: undefined };
    expect(budgetOf(old)).toEqual({ kind: "tokens", limit: EFFORT_TABLE.high.budgetTokens });
    expect(budgetOf({ ...old, effort: undefined })).toEqual({ kind: "tokens", limit: EFFORT_TABLE.medium.budgetTokens });
    expect(budgetOf(defaultRunConfig({ task: "t", workspace: "/w", engine: "replay", budgetUsd: 3 }))).toEqual({ kind: "usd", limit: 3 });
  });

  it("the roles' 'Budget and time' line speaks dollars on the direct engine and tokens on Claude Code, never both", () => {
    const direct = budgetLine(defaultRunConfig({ task: "t", workspace: "/w", engine: "anthropic", budgetUsd: 10 }), { usd: 2.5, tokens: 400_000 }, 3, 60);
    expect(direct).toBe("$7.50 of $10 remaining; 3 minutes elapsed; at most 60 turns in this phase. Pace yourself and leave the workspace clean if you must stop early.");
    const cc = budgetLine(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code", budgetTokens: 1_000_000 }), { usd: 2.5, tokens: 400_000 }, 3, 60);
    expect(cc).toBe("600,000 of 1,000,000 tokens remaining (usage counts against the Claude subscription; cache reads count a tenth); 3 minutes elapsed; at most 60 turns in this phase. Pace yourself and leave the workspace clean if you must stop early.");
    expect(cc).not.toContain("$");
  });

  it("names the exhausted budget in its unit", () => {
    expect(budgetExhaustedMessage(defaultRunConfig({ task: "t", workspace: "/w", engine: "anthropic", budgetUsd: 10 }))).toBe("Budget of $10 exhausted");
    expect(budgetExhaustedMessage(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code", budgetTokens: 1_000_000 }))).toBe("Token budget of 1,000,000 exhausted (usage counts against the Claude subscription)");
  });

  it("the config checker says a custom dollar budget is not applied on Claude Code, and presets carry budgetTokens", () => {
    const cc = defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code", effort: "medium", budgetUsd: 25 });
    const w = checkRunConfig(cc).find((x) => x.setting === "budgetUsd")!;
    expect(w).toMatchObject({ level: "info" });
    expect(w.message).toMatch(/\$25.*not applied on Claude Code.*1,000,000 tokens/);
    expect(checkRunConfig(defaultRunConfig({ task: "t", workspace: "/w", engine: "claude-code", effort: "medium" })).some((x) => x.setting === "budgetUsd")).toBe(false);
    expect(checkRunConfig(defaultRunConfig({ task: "t", workspace: "/w", engine: "anthropic", effort: "medium", budgetUsd: 25 })).some((x) => x.setting === "budgetUsd")).toBe(false);
    expect(validatePresetConfig({ budgetTokens: 500_000 }).config.budgetTokens).toBe(500_000);
    expect(() => validatePresetConfig({ budgetTokens: -1 })).toThrow(/budgetTokens must be a non-negative number/);
    expect(applyPreset(defaultRunConfig({ task: "t", workspace: "/w" }), { name: "p", config: { budgetTokens: 123_456 } }).budgetTokens).toBe(123_456);
  });
});
