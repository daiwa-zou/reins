# Writing effective tools for AI agents, with agents
Source: https://www.anthropic.com/engineering/writing-tools-for-agents
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Eval harness alongside the tool registry with metrics and transcript review | Reliability tab and per-call durations; `registry.test.ts` covers hygiene; no per-tool task evals | partial |
| Cap tool results (about 25K tokens) with strategy-teaching messages; pagination and filters | `registry.ts:12` 24K-char cap with head/tail and hint; read_file offset/limit, list_files limit, search limit | implemented |
| response_format concise/detailed; semantic names over raw IDs | list_files returns paths with sizes; no response_format parameter | partial |
| Namespacing and a registry lint for overlap and vague descriptions | `git_*` namespacing; no lint | partial |
| Actionable tool errors shown distinctly in the UI | Errors say what to do (`registry.ts:166` edit_file); CallRow shows errors in red with the message (`Stage.tsx` CallRow) | implemented |
| Tool annotations (read-only, destructive) used for gating | `ToolDef.readOnly` runs in parallel without gating (`loop.ts` execute/gate) | implemented |
| Per-tool call counts and error rates ('tool health') | Not aggregated; visible per call only | gap |
| Consolidated workflow tools over thin wrappers | `search` (rg with fallback), `list_files`, `update_progress` bundle several steps (`registry.ts`) | implemented |

## Gaps
- Derive per-tool call count, error count and total result size in `derive.ts` and show a small tool-health table on the Guardrails tab.
- Add a registry lint test that fails on duplicate parameter semantics and descriptions under 40 characters.
