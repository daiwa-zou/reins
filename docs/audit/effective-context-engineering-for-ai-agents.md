# Effective context engineering for AI agents
Source: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Track and display tokens per source (system, tools, results, history) | `loop.ts` snapshot() apportions the measured prompt over an estimated composition; Context tab gauge and history (`web/src/components/ContextGauge.tsx:22,86`) | implemented |
| Compaction as a first-class tunable stage | Server-side compaction with a configurable trigger (`loop.ts:122`, `context.compactAtTokens`); no custom preservation instructions | partial |
| Automatic tool-result clearing before full compaction | `loop.ts:114` clear_tool_uses with keep/trigger; `context.cleared` events in the feed | implemented |
| Persistent notes and memory primitives visible in the UI | `features.json` and `progress.md` written by update_progress (`orchestrator.ts:77`); features shown in the Inspector | implemented |
| Sub-agents with isolated context returning a bounded summary | `loop.ts` scout: read-only sub-loop, returns its final text only; capped at 12 turns | implemented |
| JIT retrieval tools plus a small bootstrap (CLAUDE.md) | list_files, search, read_file with offsets (`registry.ts:125-226`); CLAUDE.md/AGENTS.md handed to roles (`orchestrator.ts:54`) | implemented |
| Small, non-overlapping tool sets; prompts at the right altitude, minimal and section-structured | Prompts in `prompts.ts` are short and sectioned; tool set is 18 tools with distinct purposes; no automated lint for overlap | partial |
| Choice among compaction, notes and multi-agent, visible to the user | All three are components (compaction, progressFile, scouts) on the Harness tab; no auto-selection by task shape | partial |

## Gaps
- Add `context.preserve` (free text) to RunConfig and append it to the compaction request and the reset handoff.
- A registry lint test that flags two tools whose descriptions share most words, and parameter names like `path` vs `file`.
