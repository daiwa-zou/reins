// Markdown tables generated from the catalogue data (shared/components.ts). Pure: the
// docs:tables script writes them into docs/configuring.md between markers, and
// server/src/docs.test.ts fails when a block differs from its renderer.
import { COMPONENTS, EFFORT_COMPONENTS, EFFORT_LEVELS, EFFORT_TABLE, PAUSE_KEYS, SUPERVISION_LEVELS, SUPERVISION_TABLE, TIER_LABEL } from "./components.js";

const ENGINE_NAME = { anthropic: "Direct API", "claude-code": "Claude Code" } as const;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const label = (id: string) => COMPONENTS.find((c) => c.id === id)?.label ?? id;

export function renderEffortTable(): string {
  const head = `| | ${EFFORT_LEVELS.map((e) => EFFORT_TABLE[e].label.toLowerCase()).join(" | ")} |`;
  const sep = `|---|${EFFORT_LEVELS.map(() => "---").join("|")}|`;
  const rows = EFFORT_COMPONENTS.map((id) => `| \`${id}\` | ${EFFORT_LEVELS.map((e) => (EFFORT_TABLE[e].components[id] ? "on" : "off") + (id === "evaluator" && EFFORT_TABLE[e].rerunEveryCriterion ? " (re-runs every criterion)" : "")).join(" | ")} |`);
  const nums = (["maxFixRounds", "maxTurnsPerPhase", "budgetUsd", "budgetTokens"] as const).map((k) => `| \`${k}\` | ${EFFORT_LEVELS.map((e) => (k === "budgetUsd" ? `$${EFFORT_TABLE[e][k]}` : k === "budgetTokens" ? EFFORT_TABLE[e][k].toLocaleString("en-US") : String(EFFORT_TABLE[e][k]))).join(" | ")} |`);
  return [head, sep, ...rows, ...nums].join("\n");
}

export function renderSupervisionTable(): string {
  const rows = SUPERVISION_LEVELS.map((s) => {
    const r = SUPERVISION_TABLE[s];
    const pauses = PAUSE_KEYS.filter((k) => r.pauses[k]);
    return `| \`${s}\` | ${r.label} | ${r.chip} | ${pauses.length ? pauses.map((p) => `\`${p}\``).join(", ") : "none"} | \`${r.mode}\` | ${r.actionClassifier ? "on" : "off"} |`;
  });
  return ["| id | Label | Chip | Pauses | Guardrail mode | Action classifier |", "|---|---|---|---|---|---|", ...rows].join("\n");
}

export function renderComponentsTable(): string {
  const rows = COMPONENTS.map((c) => {
    const req = (c.requires ?? []).map((r) => `\`${r.id}\` (${cell(r.reason)})`).join("; ") || "–";
    return `| \`${c.id}\` | ${cell(c.label)} | ${TIER_LABEL[c.tier]} | ${cell(c.short)} | ${cell(c.whenOff)} | ${c.engines.map((e) => ENGINE_NAME[e]).join(", ")} | ${req} | ${c.defaultOn ? "on" : "off"} |`;
  });
  return ["| id | Component | Tier | What it does | When off | Engines | Requires | Default |", "|---|---|---|---|---|---|---|---|", ...rows].join("\n");
}

export const GENERATED_BLOCKS: Record<string, () => string> = { effort: renderEffortTable, supervision: renderSupervisionTable, components: renderComponentsTable };

const re = (name: string) => new RegExp(`(<!-- generated:${name} -->\\n)([\\s\\S]*?)\\n?(<!-- /generated:${name} -->)`);

/** The text between a block's markers, or null when the markers are missing. */
export function generatedBlock(md: string, name: string): string | null {
  const m = md.match(re(name));
  return m ? m[2] : null;
}

/** Rewrite every generated block in `md` from its renderer. */
export function applyGeneratedBlocks(md: string): string {
  let out = md;
  for (const [name, render] of Object.entries(GENERATED_BLOCKS)) out = out.replace(re(name), (_m, a, _b, c) => `${a}${render()}\n${c}`);
  return out;
}
