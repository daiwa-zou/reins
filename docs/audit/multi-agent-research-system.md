# How we built our multi-agent research system
Source: https://www.anthropic.com/engineering/multi-agent-research-system
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Orchestrator-worker primitive with structured briefs and durable plan | Orchestrator (`orchestrator.ts`) over planner/builder/evaluator; scouts take a question brief (`registry.ts:341`); plan persisted in `.reins/spec.md` | implemented |
| Effort budget by task class, visible token meter, runaway guardrails | Budget, max turns per phase, max fix rounds (`RunConfig`); scouts capped at 12 turns; budget meter in the Inspector | implemented |
| Isolated worker context returning references, not full content | Scouts return only their final text (`loop.ts` scout); roles hand off files | implemented |
| Checkpoint and resume; tool failures as data | Tool errors returned to the model (`loop.ts` execute); no mid-run resume | partial |
| Full traces with a trace viewer | JSONL log and Transcript tab (`Transcript.tsx:24`) | implemented |
| Parallel tool calls and parallel workers; async results inbox | Read-only tools run in parallel (`loop.ts` execute); scouts run inline, one at a time | partial |
| Eval loop with an LLM judge, rubric and end-state grading | Evaluator judges against the contract with evidence (`registry.ts:392`); no fixed rubric or human calibration view | partial |
| Tool descriptions as testable code; agents can rewrite them | Descriptions and examples in `registry.ts`; tested indirectly (`registry.test.ts`); no agent-driven rewriting | partial |

## Gaps
- Let the builder dispatch several scouts in one turn (they are read-only) and collect answers as they finish.
- A fixed evaluator rubric (completeness, correctness, evidence quality) alongside the per-criterion results.
