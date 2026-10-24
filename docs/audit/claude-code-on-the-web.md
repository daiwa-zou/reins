# Claude Code on the web
Source: https://www.anthropic.com/news/claude-code-on-the-web
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Same agent core locally and remotely; UI is a thin client over progress, steering, results | `server/src/engine/orchestrator.ts:162-271` pipeline is engine-agnostic; UI is a fold over the log (`web/src/state/derive.ts:87`); no remote execution target | partial |
| Default-deny network with a user-controlled allowlist | `server/src/tools/sandbox.ts:43` denies network unless allowed; `shared/types.ts` GuardrailPolicy.allowNetwork is on/off only, no domain allowlist | partial |
| Credentials never enter the sandbox; git mediated by a scoped proxy | `server/src/tools/registry.ts:71` scrubbedEnv strips keys/tokens; no git credential proxy (pushes are gated by `policy.ts:25` ask rules instead) | partial |
| Multi-session dashboard with per-session steering and results | `web/src/components/RunList.tsx` attention-first list with status, phase, cost; steering per run in `web/src/panels/Stage.tsx` | implemented |
| Nudge users toward well-scoped, verifiable tasks | Contract stage requires a verify step per criterion (`server/src/roles/prompts.ts:48`, `web/src/components/ApprovalCard.tsx:27` blocks approval without one) | implemented |
| End-of-task artifacts (PR, summary) as the primary deliverable | Run summary card (`web/src/panels/Stage.tsx:89` EndCard) plus commit per phase (`orchestrator.ts:295`); no PR creation | partial |
| Unified budget display across surfaces | Budget meter and cost in the Inspector and TopBar (`web/src/components/Inspector.tsx`); subscription usage of the Claude Code engine is shown as an estimate only | partial |

## Gaps
- Add a domain allowlist to GuardrailPolicy and pass it to the Seatbelt profile and the SDK sandbox `network.allowedDomains`.
- Add an optional 'open a PR' wrap-up step (gh pr create) gated by an approval, so the deliverable is a PR plus the summary.
- A remote execution target (SSH or container) for the same orchestrator is out of scope today; the engine interface (`LoopOptions`/`LoopResult` in `loop.ts`) is where it would plug in.
