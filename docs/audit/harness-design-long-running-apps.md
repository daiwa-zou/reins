# Harness design for long-running application development
Source: https://www.anthropic.com/engineering/harness-design-long-running-apps
Lesson file checked against the original: yes (added: the evaluator is conditional on task difficulty, the V1 evaluator's four grading criteria, and the planner's "aim ambitiously / look for AI features" brief)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| A separate evaluator is easier to make skeptical than the builder is to make self-critical | `evaluator` component (`shared/components.ts:34-44`); evaluate phase with its own loop and bash (`server/src/engine/orchestrator.ts:248-262`); EVALUATOR prompt (`server/src/roles/prompts.ts:39-47`) | implemented |
| Check the live result yourself; fail the criterion instead of talking yourself into approving | `prompts.ts:42-46` ("A criterion passes only when you observed it pass"); any failed hard criterion fails the round (`orchestrator.ts:253`); `skills/verify-like-a-user/SKILL.md` | implemented |
| Agree what done means and how to verify it before any code is written | Contract phase: `propose_contract`, evaluator `review_contract`, then user approval (`orchestrator.ts:181-226`); criteria editable inline (`web/src/components/ApprovalCard.tsx:85-109`) | implemented |
| The shape of a checkable criterion is worth a skill | `skills/writing-a-contract/SKILL.md`, indexed by name and description (`server/src/skills.ts:59-62`), read on demand with `read_skill` (`server/src/tools/registry.ts:348-358`) | implemented |
| Roles hand work over through files, never a shared context | `.reins/spec.md`, `contract.json`, `progress.md`, `evaluation.md` (`orchestrator.ts:178,218,255,80-81`); each phase gets a fresh loop (`orchestrator.ts:110-133`) | implemented |
| A planner turns a short prompt into a spec; without it the builder under-scopes | `planner` component with that assumption (`shared/components.ts:12-22`); plan phase (`orchestrator.ts:164-179`); PLANNER prompt (`prompts.ts:20-27`) | implemented |
| Keep the spec high level on technical design | `prompts.ts:25` (prompt instruction only) | implemented |
| Work through the spec one feature at a time | BUILDER work loop (`prompts.ts:32-34`); `features.json` maintained by `update_progress`, never deleted from (`orchestrator.ts:77-84,320-325`) | implemented |
| Compaction keeps continuity but gives no clean slate | `compaction` component (`shared/components.ts:100-110`); `compact_20260112` edit (`server/src/engine/loop.ts:121-122`); `context.compacted` event (`loop.ts:239-243`); SDK compaction observed via `compact_boundary` (`server/src/engine/claudeCodeLoop.ts:290-293`) | implemented |
| A reset with a structured handoff fixes context anxiety | `resetWithHandoff` (`shared/components.ts:122-133`, default off, requires progressFile); `shouldResetBuilder` reads `progress.md` (`orchestrator.ts:286-296`) but only between fix rounds and from a JSON-length estimate (`orchestrator.ts:289`), so one long build phase never resets | partial |
| Show cost and time per phase | `phase.finished` carries usage, cost and duration (`orchestrator.ts:96`) into `PhaseStat` (`web/src/state/derive.ts:41-50,138-150`); the stepper shows elapsed time per phase (`web/src/panels/Stage.tsx:178`) but cost only appears in the raw Transcript row | partial |
| Evaluator clicks through the running app (Playwright) and checks API and DB state | Evaluator has read tools plus `bash` (`orchestrator.ts:250`), so curl and SQL work; Web preset guidance says to hit real pages over HTTP (`shared/presets.ts:29-37`); no browser or screenshot tool | partial |
| Hard thresholds: any failed hard criterion fails the sprint; iterate with fix rounds | `hard` on `ContractCriterion` (`shared/types.ts:226`); `hardFail` (`orchestrator.ts:253`); fix rounds up to `maxFixRounds` (`orchestrator.ts:230,270`) | implemented |
| Calibrate the evaluator with few-shot examples and score breakdowns to reduce drift | `report_evaluation` is pass/fail plus free-text evidence (`registry.ts:411-428`); no examples, no scores, no rubric | gap |
| Read the evaluator's logs and revise the QA prompt where its judgment diverges from yours | Evaluator prompts are constants (`prompts.ts:39-47,54-57`), hashed in the request-shape note (`loop.ts:206`); `guidance` can only add lines (`prompts.ts:84-85`), not change them | partial |
| Every component encodes an assumption; remove one at a time | `assumption`/`whenOff` on every component (`shared/types.ts:54-70`; `shared/components.ts:5-10`); "run with/without →" flips one switch (`web/src/panels/Harness.tsx:44-46,209-213`) | implemented |
| The evaluator is worth its cost only beyond the model's solo reach (added) | Evaluator is a switch and Minimal turns it off (`shared/config.ts:98-105`); `costByRole` is derived (`derive.ts:166`) but rendered nowhere, so the user cannot see what the evaluator cost | partial |
| After each evaluation the generator refines or pivots on the specific findings | Failed criteria with evidence are fed into the fix-round message (`orchestrator.ts:234`); builder history is kept across rounds (`orchestrator.ts:237-239`) | implemented |
| Re-examine the harness when a new model ships | Model-changed nudge on the Harness tab (`Harness.tsx:39-41,90-94`); per-component engine lists and `checkRunConfig` warnings (`shared/config.ts:34-83`) | implemented |

## Gaps
- Reset fires only at round boundaries: compare `promptTokens` from each `context.snapshot` with `resetAtTokens` inside `AgentLoop.run`, end the phase with a `reset` reason and let the orchestrator restart the builder from `progress.md` mid-build.
- Cost per phase is hidden: render `PhaseStat.costUsd` next to the elapsed time in `PhaseStepper` and on the phase FeedRow's finished line.
- No browser evidence: a deferred Playwright `screenshot`/`browse` tool for the evaluator when a criterion's verify step names a URL, with the image shown in the Stage.
- No evaluator calibration: let `report_evaluation` take an optional 0-1 score per criterion and ship two `input_examples` (a specific FAIL with quoted output, a PASS) so the rubric stays stable across rounds.
- Prompts are not tunable: expose `systemPromptFor` templates as editable, hash-versioned text (`$REINS_HOME/prompts/<role>.md` overrides shown in the Harness tab) so evaluator calibration is a product action.
- Evaluator cost is invisible: render `costByRole` on the EndCard and hint when the evaluator cost more than the build and passed in round 1.
