# How Anthropic teams use Claude Code
Source: https://www.anthropic.com/news/how-anthropic-teams-use-claude-code
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Two supervision styles with visible check-in points | Pauses after plan, contract, before commit, after evaluation (`RunPauses` in `shared/types.ts`; `NewRun.tsx` Roles & pauses) | implemented |
| Screenshots and pasted logs as first-class inputs | Task is text only (`NewRun.tsx`); operator notes are text | gap |
| Cheap, safe read-only exploration and a project knowledge layer the agent reads and writes | Read-only tools run without prompts and in parallel (`loop.ts` readOnly); CLAUDE.md read (`orchestrator.ts:54`); progress.md written (`:77`) | implemented |
| Build/test/iterate against a design artifact with visual diff evidence | Not implemented | gap |
| Non-engineer mode with sensible defaults | Two required fields in New run, demo without a key, the Welcome walkthrough (`web/src/components/Welcome.tsx`) | implemented |
| Reusable narrow subagents | Scouts with a fixed read-only brief (`loop.ts` scout); no user-defined subagents | partial |
| Headless mode and CI-triggered runs | HTTP API only (`index.ts`); no CLI or event triggers | gap |

## Gaps
- Accept image attachments on the task (stored under the run dir, passed as image blocks in the first message).
- A `reins run` CLI over the same RunManager that streams events as JSONL, for CI and scripts.
