# Enabling Claude Code to work more autonomously
Source: https://www.anthropic.com/engineering/enabling-claude-code-to-work-more-autonomously
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Checkpoint workspace state before edits; restore code independently of conversation | Commit per phase (`orchestrator.ts:295`) and the scrubber (`Transcript.tsx:47`) cover history; no per-edit file checkpoints or restore | partial |
| Say what checkpoints do not cover; integrate with git | Commits are git commits; the end card points to the Files tab after a stop (`Stage.tsx:89`) | partial |
| Managed lifecycle for long-lived background processes | Shell commands run with a timeout in their own process group (`registry.ts:92`); no managed servers | gap |
| Hooks for deterministic guarantees at lifecycle points | Harness-level: evaluation after build, commit per phase, self-verification instruction; no user-defined hooks | partial |
| Subagents built into the engine layer | Scouts in the direct engine (`loop.ts` scout); not in the SDK engine | partial |
| UI-agnostic core with real-time streaming | WebSocket fan-out of the event log (`index.ts`); the HTTP API is the only coupling | implemented |
| Prompt history search for steering | Not implemented | gap |

## Gaps
- Support `.reins/hooks.json` with afterEdit and beforeFinish commands run by the orchestrator, surfaced as note events.
- Keep the last 20 operator notes in localStorage and offer them with the up arrow in the steer box.
