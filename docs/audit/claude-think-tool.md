# The "think" tool
Source: https://www.anthropic.com/engineering/claude-think-tool
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| A no-op think tool enabled per profile, defaulting to native extended thinking | `server/src/tools/registry.ts:262` think tool; `thinkTool` component switch in `shared/components.ts`; adaptive thinking always on in `loop.ts:329` | implemented |
| Render think content as collapsible reasoning rows distinct from tool calls | Narrated as 'Thinking: …' rows in the feed (`shared/narrate.ts`); the Stage renders native thinking blocks italic (`web/src/panels/Stage.tsx` TurnRow) with a toggle | implemented |
| Domain checklists in the system prompt, as editable templates | Checklists live in role prompts (`server/src/roles/prompts.ts:11-16`) and in skills (`skills/verify-like-a-user/SKILL.md`); prompts are not editable from the UI | partial |
| Measure consistency with pass^k repeated runs | `shared/components.ts:320` trialRates; Reliability tab (`web/src/panels/Reliability.tsx:12`) | implemented |
| Prompt the agent to assess large or surprising tool outputs before acting | Prompt line in `prompts.ts` ('Use the think tool … after surprising tool results') via `systemPromptFor`; not enforced by the harness | partial |
| Track the output-token cost of reasoning tools | Per-turn usage and cost on each feed row (`Stage.tsx` TurnRow); not broken out per tool | partial |
| Nudge a brainstorming step after a failing test | Not implemented | gap |

## Gaps
- Expose role prompts (and their checklists) as editable templates in the Harness tab, versioned by the prompt hash already logged in the request-shape note.
- After a failed evaluation round, prepend a 'list three candidate causes before editing' instruction to the fix-round message in `orchestrator.ts:228`.
