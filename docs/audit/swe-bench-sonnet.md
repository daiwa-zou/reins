# Raising the bar on SWE-bench Verified with Claude 3.5 Sonnet
Source: https://www.anthropic.com/engineering/swe-bench-sonnet
Lesson file checked against the original: yes (nothing missing)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Keep the core scaffold minimal (prompt, Bash, Edit) and let the model sequence its own steps | Builder gets read tools plus `write_file`, `edit_file`, `bash` (`server/src/engine/orchestrator.ts:21-22,237`); no fixed order inside a phase (`server/src/engine/loop.ts:189-313`); the Minimal preset drops planner, contract and evaluator (`shared/config.ts:98-105`) | implemented |
| Put operational guidance inside tool descriptions (state, output limits, background execution) | `bash`: zsh, 2-minute timeout, combined output, keep output small, no interactive commands (`server/src/tools/registry.ts:249`); `read_file` offset/limit (`registry.ts:128`); `list_files` ignore list (`registry.ts:188`); `edit_file` uniqueness rule (`registry.ts:169`) | implemented |
| Exact-match single-occurrence edits with informative errors; absolute paths; `create` refuses to overwrite | `edit_file` errors on zero or multiple matches with what to do (`registry.ts:177-179`); paths are workspace-relative and confined (`server/src/guardrails/policy.ts:120-122`; `registry.ts:129`) so the cwd problem does not arise; `write_file` silently overwrites and reports "Overwrote" (`registry.ts:161-163`) | partial |
| Truncate and mark clipped output; teach the agent to page | Head-and-tail truncation with a narrowing hint (`registry.ts:57-65`); `read_file` "[... N more lines; total M]" (`registry.ts:146`); `list_files` cap note (`registry.ts:222`); the SDK engine slices at 24,000 chars without a hint (`server/src/engine/claudeCodeLoop.ts:340`) | implemented |
| Expect long runs: budget, checkpoint, display progress | `budgetUsd` and `maxTurnsPerPhase` (`shared/components.ts:363-364`; `loop.ts:192-196`); `progress.md`/`features.json` (`orchestrator.ts:77-84`); budget meter (`web/src/components/Overview.tsx:83-85`) and phase stepper (`web/src/panels/Stage.tsx:160-185`) | implemented |
| Reproduce, fix, rerun; make the reproduction script and its before/after output visible as evidence | Contract verify steps and self-verification (`orchestrator.ts:236`; `server/src/roles/prompts.ts:34,37`); evaluator evidence per criterion. No instruction to write a reproduction script and no before/after pairing in the UI | partial |
| Separate environment and grading failures from agent failures in telemetry | Interrupted runs count as cancelled (`server/src/engine/trials.ts:19-21`); every other failure is undifferentiated (see the infrastructure-noise audit) | partial |
| Provide image and file viewing so the agent can inspect rendered artifacts | `read_file` is UTF-8 text only (`registry.ts:128,141`) and no tool returns image blocks on the direct engine; the SDK engine's built-in `Read` can view images and is only gated by `canUseTool` (`claudeCodeLoop.ts:127-137`) | partial |
| Hidden tests: the model believes it succeeded when it did not; verify independently | The evaluator reruns every verify step itself (`prompts.ts:43`) and the user approves the contract so criteria are not the builder's alone (`orchestrator.ts:199-216`) | implemented |
| Do not modify tests; make minimal non-test changes | No rule: the builder may edit any file including tests; no diff check on test files after a round | gap |
| Tool descriptions deserve as much design attention as human interfaces; iterate to pre-empt misreadings | `toolExamples` component (`shared/components.ts:167-177`); `input_examples` on `edit_file`, `bash`, `propose_contract` (`registry.ts:183,260,390-400`) | implemented |
| Benchmarks measure model plus scaffold; keep the scaffold recorded and constant | `effectiveConfig` foundation (`shared/components.ts:287-292`); `harnessVersion` on each trial (`trials.ts:16,22`) shown in Reliability (`web/src/panels/Reliability.tsx:124`) | implemented |
| Bash: shell state persists across calls; run long-lived commands in the background | Each `bash` call spawns a fresh `zsh -lc` (`registry.ts:91-93`), so cwd and variables do not persist and the description does not say so; the prompt forbids long-lived servers without a timeout (`prompts.ts:17`); the Web preset uses `timeout 120 npm run dev` (`shared/presets.ts:29-37`) | partial |
| Encourage thorough, long reasoning when cost is no concern | Adaptive thinking with per-role effort (`loop.ts:328-331`; `shared/types.ts:101-106`) | implemented |
| The model should try a different solution instead of repeating a mistake | Denials tell the agent to find another way (`loop.ts:421`); "Errors from tools are information" (`prompts.ts:15`) | implemented |

## Gaps
- `write_file` overwrites: require `overwrite: true` to replace an existing file and return "exists; pass overwrite:true or use edit_file".
- No reproduction evidence: add a build-stage line "write a script that reproduces the failure, run it, fix, rerun" and have the evaluator's `evidence` carry before/after output, shown as a pair on the Contract tab.
- Failure kinds are not separated: `Trial.failureKind` as in the infrastructure-noise audit.
- No image viewing on the direct engine: a `view_image` tool returning an image content block for PNG/JPEG files under the workspace, size-capped.
- Tests are editable: record the test files named in contract `verify` commands at `contract.agreed` and have the evaluator fail the round when `git diff --name-only <baseSha>` includes them without a criterion allowing it.
- Shell state does not persist and the description is silent: say so in the `bash` description ("each call starts a fresh shell in the workspace; chain with && or cd inside the command").
- SDK truncation has no hint: reuse `truncate()` from `registry.ts` at `claudeCodeLoop.ts:340`.
