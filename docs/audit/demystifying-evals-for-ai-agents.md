# Demystifying evals for AI agents
Source: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Every trial is a first-class record with transcript, tool calls and metrics | Run = JSONL log (`runStore.ts:28`); `trials.ts:6` trialFromEvents derives outcome, cost, duration, fix rounds; tokens per turn in `turn.finished` | implemented |
| Separate capability and regression suites with graduation | Not implemented; only ad-hoc trial sets by task text (`shared/components.ts:326`) | gap |
| Report pass@k and pass^k per task with visible variance | `shared/components.ts:320` trialRates; Reliability tab shows both and refuses to project when n < k (`Reliability.tsx`) | implemented |
| Flag 0%-everywhere tasks and require a reference solution | Not implemented | gap |
| Per-trial isolation: fresh sandbox, no shared history | Repeats run sequentially in the same workspace (`runManager.ts:263`); `.reins/` notes deliberately carry over | gap |
| Transcript viewer with failure filters and grader verdicts beside the step | Transcript tab with type and role filters and search (`web/src/panels/Transcript.tsx:24`); evaluator verdicts per criterion on the Contract tab; no 'grader wrong' marking | partial |
| Outcome-based graders with partial credit and an Unknown option | Evaluator reports pass/fail with evidence per criterion (`registry.ts:392` report_evaluation); hard vs soft criteria; no partial credit or Unknown | partial |
| Read the transcripts; layered signals (CI evals, production sampling) | Narrated feed and scrubber make reading cheap (`Stage.tsx`, `Transcript.tsx:47`); CI runs unit tests only (`.github/workflows/ci.yml`) | partial |

## Gaps
- Add an `unknown` outcome to `CriterionResult` and treat it as neither pass nor fail in `orchestrator.ts:250`.
- Add a 'grader wrong' flag per criterion result (stored as a `note` event) so disputed verdicts are visible in the Reliability set.
- Offer 'fresh worktree per trial' in the repeat endpoint (git worktree add) for isolated trials.
