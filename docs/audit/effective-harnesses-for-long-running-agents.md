# Effective harnesses for long-running agents
Source: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Separate initialization (spec, progress log, initial commit) from repeatable work | Plan phase writes spec and feature list (`orchestrator.ts:162`); build phase is separate (`:228`); no init.sh | partial |
| Machine-readable task ledger where the agent may only change status; enforce structurally | `orchestrator.ts:317` mergeFeatures never deletes; status enum validated by the tool schema (`registry.ts:271`) | implemented |
| Fixed session preamble: git log, progress file, ledger, bootstrap, smoke test | Builder prompt preamble (`prompts.ts:32`); not enforced by the harness, and no bootstrap script | partial |
| One unit of work per session and a clean-state exit; flag dirty trees | Commit per phase (`orchestrator.ts:295`); builder told to finish clean; wrap-up warns when features.json was not kept current | partial |
| Durable handoff in files and git, shown as first-class panels | `.reins/spec.md`, `contract.json`, `progress.md`, `evaluation.md`; features and commits in the Inspector, diffs on the Files tab | implemented |
| End-to-end verification before done, with evidence; know the verifier's blind spots | Evaluator re-runs verify steps and must quote evidence (`prompts.ts:38-46`); skill `verify-like-a-user`; no browser automation | partial |
| Harness-known environment bootstrap run automatically | Not implemented | gap |
| Pluggable role prompts over a constant harness | `systemPromptFor` in `prompts.ts` keyed by role; loop factory in `orchestrator.ts` by engine | implemented |

## Gaps
- Add `.reins/init.sh`: written by the planner, run by the harness at the start of every build phase with its output logged.
- Refuse `finish` while `git status` is dirty when gitCommits is on, returning the dirty list to the builder.
- A deferred `screenshot` tool (Playwright) for web contracts.
