# Lesson audit

Written by an independent audit pass: each post was re-fetched, the lesson file checked against it, and every learning traced to code (`path:line`), a component or a foundation. Statuses: implemented (code or UI does it), partial (something adjacent exists), gap.

**Totals across 10 lessons:** 53 implemented · 76 partial · 25 gaps

| Lesson | implemented | partial | gap |
|---|---|---|---|
| [A postmortem of three recent issues](a-postmortem-of-three-recent-issues.md) | 3 | 5 | 6 |
| [Introducing advanced tool use on the Claude Developer Platform](advanced-tool-use.md) | 7 | 6 | 2 |
| [Equipping agents for the real world with Agent Skills](agent-skills.md) | 4 | 8 | 2 |
| [Building AI-resistant technical evaluations](ai-resistant-technical-evaluations.md) | 3 | 7 | 4 |
| [An update on recent Claude Code quality reports](april-23-postmortem.md) | 4 | 8 | 3 |
| [Building agents with the Claude Agent SDK](building-agents-with-the-claude-agent-sdk.md) | 6 | 6 | 3 |
| [Building a C compiler with parallel Claudes](building-c-compiler.md) | 4 | 9 | 2 |
| [Building effective agents](building-effective-agents.md) | 9 | 6 | 0 |
| [How we built Claude Code auto mode: a safer way to skip permissions](claude-code-auto-mode.md) | 7 | 6 | 3 |
| [Claude Code: Best practices for agentic coding](claude-code-best-practices.md) | 6 | 15 | 0 |

## Open gaps

- **a-postmortem-of-three-recent-issues**: No canary check on model output: add a `text`/`tool.result` post-processor that flags non-target-script characters and unparsable code written by `write_file`/`edit_file` (a `tsc`/`node --check`/`python -m py_compile` probe by extension) and emits a warn `note`.
- **a-postmortem-of-three-recent-issues**: Quality signals are not sliced: let `groupTrials` optionally key by `model`, `engine` and `harnessVersion` (fields already on `Trial`) and add a "segment by" selector to the Reliability tab.
- **a-postmortem-of-three-recent-issues**: No report-to-change correlation: add a one-click "Report this run" that writes `~/.reins/reports/<runId>.json` with the config, harness version and a pointer to the event log, and list reports by harness version next to trial sets.
- **a-postmortem-of-three-recent-issues**: Request/user-level stickiness is not represented: at minimum show, per trial set, how many consecutive failures occurred (a sticky-failure streak) rather than only the pass rate.
- **a-postmortem-of-three-recent-issues**: Evaluation is outcome-only: add transcript-level checks to the evaluator's report (count of tool errors, denied actions, truncated outputs, non-ASCII bursts in model text) as soft criteria.
- **a-postmortem-of-three-recent-issues**: Workarounds in `recover()` are untracked: give each flag a comment with the API error it masks and a test in `loop.test.ts` that fails without the workaround (there is one such test today, at `loop.test.ts:145`).
- **a-postmortem-of-three-recent-issues**: No redacted export: add `GET /api/runs/:id/export` that writes the JSONL with tool outputs scrubbed by the same patterns as `scrubbedEnv`.
- **a-postmortem-of-three-recent-issues**: No cross-engine equivalence test: run the orchestrator end-to-end test once per engine with the same scripted inputs and assert the event sequence matches, and add a CI workflow that runs `npm test`.
- **a-postmortem-of-three-recent-issues**: No feedback path: a `/bug`-style action in the TopBar that captures the selected run's config and last N events into a report file.
- **a-postmortem-of-three-recent-issues**: Beta flags active per request are not in the trace: include `betas` and `context_management` edit types in `turn.finished` so a rejected or absent beta is joinable to a quality change.
- **advanced-tool-use**: No MCP toolsets: add an `mcpServers` entry to `RunConfig` and, in the direct engine, fetch each server's tool list and register it in `ALL_TOOLS` with `deferred: true` by default and a per-tool `alwaysLoad` override.
- **advanced-tool-use**: Deferred set and token cost are invisible: in the Inspector list all tools with a loaded/deferred badge and `estimateTokens(JSON.stringify(schema))` next to each.
- **advanced-tool-use**: No programmatic tool calling: add a `run_code` tool that executes a short script in the sandbox with Reins tools exposed as functions (via a local HTTP shim) and returns only stdout, flagging it in the Stage as a collapsible group of inner calls.
- **advanced-tool-use**: No idempotency metadata or return-format docs: add `idempotent: boolean` and a `returns` description to `ToolDef` and refuse non-idempotent tools inside `run_code` without approval.
- **advanced-tool-use**: Nested tools lack examples: add one `input_examples` entry each to `update_progress`, `review_contract` and `report_evaluation`, and a `registry.test.ts` case that fails when a tool with an array-of-object parameter has no example.
- **advanced-tool-use**: No tool-token alert: emit a warn `note` from `snapshot()` when the estimated tool-schema slice exceeds 10K tokens and suggest deferring.
- **advanced-tool-use**: No bottleneck telemetry: derive per-tool call count, error count and total result tokens in `derive.ts` and show them in the Guardrails or Context tab.
- **advanced-tool-use**: Truncation instead of selective return: let `bash` accept an optional `summary_only` flag that returns exit code plus the last 20 lines, and record the full output to `.reins/logs/` for the UI.
- **agent-skills**: Level 3 files are unreachable for bundled/user skills: let `read_skill` accept an optional `file` argument that reads a named sibling file from the skill's own directory (path-confined to `s.dir`).
- **agent-skills**: Skill index cost is invisible: compute `estimateTokens(skillsPromptSection(...))` in `projectContext` and emit it in the Environment note and the Context tab.
- **agent-skills**: No name/description lint: in `loadSkills` warn (via a `note` event at run start) when `description` is empty, over 200 characters, or duplicates another skill's.
- **agent-skills**: No runnable-script convention: parse an optional `scripts:` frontmatter list and expose each as a deferred tool that runs `bash <skill-dir>/<script>` under the sandbox, so "run this" is explicit and shows as a tool call.
- **agent-skills**: No authoring loop: after `wrapup`, when the evaluation failed at least once, prompt the builder (or offer the user a button) to write `.reins/skills/<slug>/SKILL.md` capturing what went wrong and what fixed it.
- **agent-skills**: No trust gating: show installed skills with `source` and file list in the Harness tab, and require a one-time approval (`approval.requested` kind `skill`) before a workspace or user skill is indexed for a run.
- **agent-skills**: No installed-skills view or files-loaded trace: add a "Skills" section to the Inspector listing installed skills, highlighting the ones read this run (from `tool.called name=read_skill`).
- **agent-skills**: No version field: parse `version:` from frontmatter and include it in the Environment note so a skill change is joinable to a quality change.
- **ai-resistant-technical-evaluations**: No per-version comparison: add a "by harness version" (and "by model") breakdown inside each trial set, reusing `trialRates` on the subset.
- **ai-resistant-technical-evaluations**: No score-vs-budget view: plot each trial's `costUsd` (x) against outcome and `fixRounds` (y) in the Reliability tab; a scatter is enough.
- **ai-resistant-technical-evaluations**: Steering is not separated in results: count `steer.delivered` events in `trialFromEvents` and show steered trials with a marker; offer "unsteered only" rates.
- **ai-resistant-technical-evaluations**: Tool-building is not recorded: when `write_file` targets a path that is later the argument of a `bash` call in the same phase, emit a `note` "built and ran a helper script" so the Transcript can filter on it.
- **ai-resistant-technical-evaluations**: No private task library: add `~/.reins/tasks/*.md` with frontmatter `created` and `public: false`, selectable in the New run dialog, and show task age on the trial set.
- **ai-resistant-technical-evaluations**: No numeric metric: allow a contract criterion to carry an optional `metric` command whose numeric stdout is recorded per evaluation round and trended in the Contract tab.
- **ai-resistant-technical-evaluations**: No action timeline: render `tool.called` events on a time axis per role (one lane each) in the Transcript header so a stall or a loop is visible at a glance.
- **ai-resistant-technical-evaluations**: No task taxonomy: add optional `tags` to `RunConfig` and group trial sets by tag.
- **ai-resistant-technical-evaluations**: A finished run cannot be extended: add "Continue with +$N budget" that starts a new run with `resume` of the builder session (claude-code engine) or the saved `builderHistory` (direct engine).
- **april-23-postmortem**: Context operations lack a trigger and a payload: include the configured threshold and `promptTokens` at the moment of the edit in `context.compacted`/`context.cleared`, and list the cleared `tool_use_id`s so the Transcript can mark them.
- **april-23-postmortem**: No anomaly alert: in `derive.ts` flag a run when `context.cleared` fires on three consecutive turns or inside a turn that has an unresolved `tool.called`, and surface it as a warn note in the Stage.
- **april-23-postmortem**: No resume/idle tests: add a `claudeCodeLoop.test.ts` case that constructs the loop with `resumeSessionId` and asserts `resume` is passed, and a `loop.test.ts` case that queues a steer while a tool call is pending.
- **april-23-postmortem**: Active betas are not in the trace: add `betas` and `contextManagement` edit types to `turn.finished`.
- **april-23-postmortem**: No prompt version: hash `systemPromptFor(...)` output per role and include it in the Environment note and `turn.finished`, so a prompt edit is joinable to a trial set.
- **april-23-postmortem**: No model-gated prompt lines: let `systemPromptFor` accept the role's model and keep per-model extras in a `Record<modelPrefix, string[]>` so quirk fixes cannot leak to other models.
- **april-23-postmortem**: No per-model/effort segmentation: record `effort` on `Trial` and let the Reliability tab split a set by model, effort and harness version.
- **april-23-postmortem**: No CI: add a workflow running `npm run typecheck` and `npm test` on every PR, and a scripted `claude -p` review step over the diff.
- **april-23-postmortem**: No feedback path: add a "Report this run" action that bundles config + events into `~/.reins/reports/`.
- **building-agents-with-the-claude-agent-sdk**: Scouts are missing from the SDK engine: register `delegate_scout` in the in-process MCP server (`claudeCodeLoop.ts:45`) and implement it with a nested read-only `query()`, or allow the SDK's `Agent` tool and map its `parent_tool_use_id` messages to a scout role instead of dropping them (`claudeCodeLoop.ts:235,262`).
- **building-agents-with-the-claude-agent-sdk**: No preservation hook for compaction: add `context.preserve: string` to `RunConfig`, pass it as the compaction instruction where the API allows it, and append it to the handoff note on reset.
- **building-agents-with-the-claude-agent-sdk**: No MCP integration: add `mcpServers` to `RunConfig` and surface their tools as deferred entries in `ALL_TOOLS` (direct engine) and `options.mcpServers` (SDK engine).
- **building-agents-with-the-claude-agent-sdk**: No harness-owned lint feedback: run the workspace's configured lint/typecheck (from `package.json` scripts) after each `write_file`/`edit_file` burst and return the first error line as a tool `note`.
- **building-agents-with-the-claude-agent-sdk**: No screenshots: add a deferred `screenshot` tool (Playwright, two viewports) available when the contract names a URL, and show the images in the Stage.
- **building-agents-with-the-claude-agent-sdk**: The judge is not cost-gated: expose `evaluator` budget share in the config and skip the evaluation phase when all hard criteria have a shell `verify` that the builder already ran green (record it as "verified by command").
- **building-agents-with-the-claude-agent-sdk**: No failure-to-eval loop: add "Save as task" on a failed run that writes the task, workspace and contract to `~/.reins/tasks/` for repeat trials.
- **building-agents-with-the-claude-agent-sdk**: Coding assumptions are baked in: move git/test preamble lines from `BUILDER` into a `coding` profile selected by config, with a `general` profile that skips commits and baseline test runs.
- **building-c-compiler**: No run-forever mode: add a `loopUntilDone` option that, after wrapup, starts a new run on the same config while `features.json` has non-done items and budget remains, with each iteration's starting sha in its Environment note.
- **building-c-compiler**: No git coordination: out of scope for one builder, but to allow N parallel runs add a `.reins/locks/<feature-id>` claim written by `update_progress` when a feature goes `in_progress`, refused if the file exists.
- **building-c-compiler**: No regression gate on commits: run the contract's hard `verify` commands before `commit()` and skip the commit (with a warn note) when one fails.
- **building-c-compiler**: No fast-sample tests: add a `verify_sample` helper that runs a deterministic 10% subset of test files (seeded by run id) and tell the builder to use it between features and the full suite before `finish`.
- **building-c-compiler**: Full output is lost: write untruncated tool output to `~/.reins/runs/<id>/tool-output/<toolUseId>.txt` and link it from the CallRow when `truncated` is true.
- **building-c-compiler**: The model is time-blind: include elapsed minutes and remaining USD in the operator note delivered before each turn (`deliverSteer`) or in the phase's first message.
- **building-c-compiler**: No shards or bisection: when a hard criterion fails for the same reason on two consecutive rounds, have the orchestrator ask a scout for a bisection plan and feed it to the fix round.
- **building-c-compiler**: `pkill` is allowed and the server is in the agent's process tree: add `/\bpkill\b/` to `DENY`, and spawn shell commands under `setsid`/a separate process group so a stray kill cannot reach the server.
- **building-c-compiler**: A green evaluation finishes the run unattended: default `pauses.afterEvaluation` to true, or add a "Mark as shipped" button distinct from the pass badge.
- **building-c-compiler**: Failures do not become tests: on a failed round, append the failing criterion to `.reins/regressions.json` and have the contract evaluator pull those in as hard criteria on the next run of the same task.
- **building-effective-agents**: Patterns are not composable: let `RunConfig` choose a `pipeline` preset (`agent-only`, `build+evaluate`, `full`) by pre-setting the component switches, and add a `voting` option that runs the evaluator N times and passes on a configurable majority.
- **building-effective-agents**: Raw request is not inspectable: emit a `request.sent` event (system prompt hash and text once per phase, tool names, betas) and render it in the Transcript under "Phases & turns".
- **building-effective-agents**: Tool workbench is missing: add `POST /api/tools/:name/try` that runs a tool against a scratch workspace and a small panel in the Harness tab to exercise schemas with sample inputs.
- **building-effective-agents**: Tool definitions are untested: add `registry.test.ts` cases for each tool's happy path and its documented error message.
- **building-effective-agents**: No voting threshold: see pipeline preset above; expose `evaluatorVotes` and `passThreshold`.
- **building-effective-agents**: Everything defaults on: add a "minimal" preset in the New run dialog that enables only the builder, narration and guardrails, so the measured path starts simple.
- **building-effective-agents**: Human review after a passing evaluation is optional and off: default `pauses.afterEvaluation` to true for the first run on a workspace.
- **claude-code-auto-mode**: Classifier coverage is regex-gated: in auto mode send every non-`SAFE_PREFIX` `bash` command, `http_fetch` URL and `delegate_scout` question to `classifyAction`, using the regex only as a fast pre-filter.
- **claude-code-auto-mode**: No allow rules to drop: add `allowPatterns` to `GuardrailPolicy`, and when `mode === "auto"` ignore any pattern that matches a blanket interpreter or shell (`/^(python|node|ruby|sh|bash)\b/`, `npm run`) with a note.
- **claude-code-auto-mode**: Single-stage classifier: add a stage-1 call with `max_tokens: 1` and a yes/no instruction using the same system prompt, and run the current structured call only on "yes".
- **claude-code-auto-mode**: No environment or allow-exception slots: add `guardrail.environment: string[]` (trusted hosts/orgs) and `guardrail.allowExceptions: string[]` to the config, render them in the classifier prompt, and add `GET /api/guardrails/defaults` that dumps the built-in rule groups.
- **claude-code-auto-mode**: No escalation counter: track consecutive and total denials per role in `AgentLoop`, pause the run with an `approval.requested` after 3 consecutive or 20 total, and show the counter in the Guardrails tab.
- **claude-code-auto-mode**: Injection probe is a regex: when `sniffInjection` fires, run a one-shot classifier call over the output before deciding to wrap, and badge the CallRow ("flagged") instead of a separate note row.
- **claude-code-auto-mode**: Scout delegation is unchecked: classify the scout question on dispatch in auto mode and attach the scout's tool-call count and any sniff hits to its returned answer.
- **claude-code-auto-mode**: Miss rate is undocumented: add a line to the Guardrails tab and README stating that the classifier is single-stage and unmeasured, with a link to the lesson's 17% figure.
- **claude-code-auto-mode**: Payloads are judged piecemeal: when `bash` executes a file written earlier in the same phase, prepend that file's content to the classifier input.
- **claude-code-best-practices**: No user-triggered reset or side channel: add a "Reset builder with handoff" button (emits `context.reset` and drops `builderHistory`) and a "Ask without recording" box that routes a question to a scout instead of the builder.
- **claude-code-best-practices**: No preservation rules: add `context.preserve` to `RunConfig`, included in the compaction request and the handoff note.
- **claude-code-best-practices**: No per-turn goal check or stop hook: add an optional `verifyCommand` to `RunConfig` run by the harness after each builder turn (deterministic), blocking `finish` until it exits 0, with a cap of N consecutive blocks before pausing for the human.
- **claude-code-best-practices**: Plan is not editable: render the spec in the `afterPlan` ApprovalCard as a textarea and write the edited text back to `.reins/spec.md` on approve.
- **claude-code-best-practices**: No hooks or CLAUDE.md lint: support `.reins/hooks.json` with `afterEdit` and `beforeFinish` shell commands run by the orchestrator, and emit a warn note when CLAUDE.md exceeds 6000 characters instead of truncating silently.
- **claude-code-best-practices**: No allow patterns: add `allowPatterns` to `GuardrailPolicy` (narrow, e.g. `^npm run lint`) honoured before the `ASK` rules.
- **claude-code-best-practices**: No checkpoints: snapshot files touched by `write_file`/`edit_file` under `~/.reins/runs/<id>/checkpoints/<seq>/` and add "Restore workspace to here" in the Transcript scrubber.
- **claude-code-best-practices**: No resume of interrupted runs: persist `builderHistory` (direct) or `builderSession` (SDK) to the run dir after each phase and offer "Resume" on runs marked interrupted.
- **claude-code-best-practices**: No headless mode or parallel fan-out: add `reins run --task ... --workspace ... --json` that drives the same `RunManager` and streams events as JSONL, and allow parallel repeats when each run gets its own `git worktree`.
- **claude-code-best-practices**: No MCP or piping: see MCP gap in advanced-tool-use; add `--stdin` to the CLI to attach piped text to the task.
- **claude-code-best-practices**: Fix rounds keep the polluted history: after a failed round, start the builder from a fresh conversation with the evaluation summary as the handoff (reuse `shouldResetBuilder`) when `maxFixRounds` is reached once.
- **claude-code-best-practices**: Tests are editable by the builder: in the contract stage, record the test files named in `verify` commands and have the evaluator fail a round when `git diff` shows them modified.
- **claude-code-best-practices**: No interview step: add an optional "Interview me" pre-phase that uses `approval.requested` prompts to ask 3-5 questions and writes the answers into the spec.
