# Redesigning source control at Anthropic
Source: https://www.anthropic.com/engineering/redesigning-source-control
Lesson file checked against the original: yes (nothing missing)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Agents are always-online clients: fetch code, history, diffs and blame via an API; working copies optional and sparse | Agents read the local checkout directly (`server/src/tools/registry.ts:126-150`); `git_status`/`git_diff` tools (`registry.ts:296-305`); Files tab via `git diff` (`server/src/index.ts:271-292`; `server/src/workspace.ts:changedFiles`). A full local repo is required (`server/src/engine/orchestrator.ts:141-145`); no sparse or virtual checkout | partial |
| Commits cheap and lock-free from the agent's view; avoid long-lived refs and branches as global state | One commit per phase on the current branch, no branch creation (`orchestrator.ts:298-312`; `git_commit` `registry.ts:307-311`); `git push` asks and force push is denied (`server/src/guardrails/policy.ts:18,54`) | implemented |
| Automated bisect and revert pipelines the harness can trigger as tools | None: git tools are status, diff and commit only (`registry.ts:296-311`); the base sha is recorded (`orchestrator.ts:145`) but there is no revert-to-base action | gap |
| Prefer post-merge and pre-deploy testing over a serialized merge queue; show post-merge health | The evaluator runs after each build round (`orchestrator.ts:248-262`), a pre-merge gate; nothing runs after the final commit and there is no CI hook; trial sets are the only repeated health signal (`web/src/panels/Reliability.tsx`) | partial |
| Intent-level review aids: semantic approval rules (comment-only vs logic) and summaries of what a change is for | `reviewIntent` foundation (`shared/components.ts:311-316`): contract and evidence (`web/src/panels/Contract.tsx:6-78`), phase summaries (`orchestrator.ts:96`; `web/src/panels/Stage.tsx:196`), per-file diffs (`web/src/panels/Files.tsx`); no classification of changes | partial |
| Encode architectural constraints as explicit, checkable rules; let a human dismiss a finding with a recorded reason | DENY/ASK rules plus user `denyPatterns`/`askPatterns` (`policy.ts:13-64,81-105`); CLAUDE.md conventions handed to roles (`orchestrator.ts:50-58`); `guidance` lines (`server/src/roles/prompts.ts:84-85`). Approvals record a note (`web/src/components/ApprovalCard.tsx:120`; `server/src/engine/runManager.ts:252-259`), but the after-evaluation approval can only stop the run, not overrule a FAIL (`orchestrator.ts:265-268`); no path-level constraints | partial |
| Per-component monitoring agents ("superfans") with telemetry alongside traditional alerts | None; the Reliability tab and EndCard are passive | gap |
| Per-directory permissions so blast radius is bounded by path | Workspace-level confinement only (`policy.ts:119-127`; `server/src/engine/claudeCodeLoop.ts:118-126`); Seatbelt writable set (`server/src/tools/sandbox.ts:25-39`); no allow or deny by path inside the workspace | partial |
| Content-addressed, immutable, cacheable data for artifacts (logs, blobs, snapshots) | Events keyed by `seq` in an append-only file (`server/src/engine/bus.ts:30`); full tool outputs keyed by `toolUseId` (`server/src/engine/loop.ts:504-512`); not content-addressed, no hash chain | partial |
| Engineers supply system-level understanding and say "no" to constraint violations | Pauses, steer notes (`runManager.ts:261-266`) and inline contract editing (`ApprovalCard.tsx:85-109`) are the "no" points | implemented |
| Adversarial review can over-engineer; weigh findings against trust boundaries | The contract evaluator is told to remove vague criteria and tighten, not add ceremony (`prompts.ts:54-57`); the user removes criteria before approval (`ApprovalCard.tsx:85-109`) | implemented |
| Reviewers focus on the intent of a change, not every line | Contract tab is the default review surface, diffs are optional (`README.md:46-49`; `Files.tsx:8-75`) | implemented |
| Hermetic simulations of infrastructure interactions as the testing strategy | Loop and orchestrator tested end to end against a scripted Messages API over a temp git repo (`server/src/engine/loop.test.ts:222-260`); the Seatbelt profile is probed for real (`server/src/tools/sandbox.test.ts:16-28`) | implemented |

## Gaps
- No bisect or revert: a deferred `git_revert_to_base` (reset to the run's `baseSha` behind an approval) and a `git_bisect` helper the fix round can call when the same hard criterion fails twice.
- No post-merge signal: an optional wrapup step that reruns the contract's hard `verify` commands after the final commit and records a `postmerge.result` event.
- No semantic change classes: classify `files.changed` by extension and diff shape (docs-only, tests-only, logic) and show the class on the Files tab and the EndCard.
- Findings cannot be dismissed with a reason: in the after-evaluation approval allow "accept despite FAIL", recording the note and marking the round `overruled`.
- No path constraints: `guardrail.protectedPaths: string[]` (globs) enforced in `confinePath` for writes and in `classifyBash` as an ask when mentioned.
- No monitoring agent: a scheduled read-only scout over the last N runs' logs that posts a `note` on anomalies (error rate or cost drift) to the Reliability tab.
- Artifacts are not content-addressed: name saved tool outputs by the sha256 of their content and add a per-line hash chain to the JSONL export.
