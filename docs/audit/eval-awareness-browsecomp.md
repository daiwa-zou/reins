# Eval awareness in Claude Opus 4.6's BrowseComp performance
Source: https://www.anthropic.com/engineering/eval-awareness-browsecomp
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Carry 'how not to' constraints alongside the task | Role prompts carry method rules (`prompts.ts:11-17`); the contract can include negative criteria; no dedicated field | partial |
| Flag budget anomalies and strategy drift | Budget cap stops runs (`loop.ts` remainingBudget); no anomaly detection relative to a median | partial |
| Filter fetched content by pattern, not only URL | `classifier.ts:48` sniffInjection runs on every tool output and wraps flagged text | implemented |
| Deliberate tool constraints with logging when hit repeatedly | Denials are logged and escalate after 3 in a row or 20 total (`loop.ts:442` noteDenial) | implemented |
| Monitor per-subagent, let subagent queries be inspected and vetoed | Scout questions and turns are logged under role=scout (`loop.ts` scout); no veto before dispatch | partial |
| Isolate runs from production side effects; prefer read-only or sandboxed network | Network off by default, Seatbelt sandbox, workspace confinement (`sandbox.ts`, `policy.ts:89`) | implemented |
| Require verification against primary sources and record provenance | Evaluator must quote commands and output per criterion (`prompts.ts:38`); shown on the Contract tab | implemented |

## Gaps
- Add `constraints: string[]` to RunConfig, rendered in every role's first message as 'Do not'.
- Warn when a run's token use passes 3x the median of its trial set.
