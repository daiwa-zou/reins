# Lesson audit

Every learning is traced to code (`path:line`), a component or a foundation, with statuses implemented (code or UI does it), partial (something adjacent exists) and gap, plus the smallest change that would close each gap. All 30 files were written by independent audit passes that re-fetched each post and checked the lesson file against it.

**Totals across 30 lessons:** 177 implemented · 209 partial · 61 gaps

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
| [Claude Code on the web](claude-code-on-the-web.md) | 5 | 7 | 1 |
| [Beyond permission prompts: making Claude Code more secure and autonomous](claude-code-sandboxing.md) | 4 | 11 | 0 |
| [The "think" tool: Enabling Claude to stop and think in complex tool use situations](claude-think-tool.md) | 5 | 7 | 1 |
| [Code execution with MCP: Building more efficient agents](code-execution-with-mcp.md) | 4 | 7 | 2 |
| [Confidential Inference via Trusted Virtual Machines](confidential-inference-trusted-vms.md) | 3 | 8 | 2 |
| [Demystifying evals for AI agents](demystifying-evals-for-ai-agents.md) | 9 | 4 | 6 |
| [Desktop Extensions: One-click MCP server installation for Claude Desktop](desktop-extensions.md) | 6 | 7 | 0 |
| [Effective context engineering for AI agents](effective-context-engineering-for-ai-agents.md) | 9 | 6 | 0 |
| [Effective harnesses for long-running agents](effective-harnesses-for-long-running-agents.md) | 9 | 7 | 1 |
| [Enabling Claude Code to work more autonomously](enabling-claude-code-to-work-more-autonomously.md) | 4 | 7 | 4 |
| [Eval awareness in Claude Opus 4.6's BrowseComp performance](eval-awareness-browsecomp.md) | 3 | 6 | 4 |
| [Harness design for long-running application development](harness-design-long-running-apps.md) | 13 | 5 | 1 |
| [How Anthropic teams use Claude Code](how-anthropic-teams-use-claude-code.md) | 5 | 6 | 2 |
| [How we contain Claude across products](how-we-contain-claude.md) | 7 | 8 | 1 |
| [Infrastructure noise in agentic coding evals](infrastructure-noise.md) | 2 | 8 | 3 |
| [Scaling Managed Agents: Decoupling the brain from the hands](managed-agents.md) | 5 | 6 | 2 |
| [How we built our multi-agent research system](multi-agent-research-system.md) | 6 | 8 | 1 |
| [Redesigning source control at Anthropic](redesigning-source-control.md) | 5 | 6 | 2 |
| [Raising the bar on SWE-bench Verified with Claude 3.5 Sonnet](swe-bench-sonnet.md) | 9 | 5 | 1 |
| [Writing effective tools for AI agents, with agents](writing-tools-for-agents.md) | 11 | 4 | 2 |

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
- **claude-code-on-the-web**: No domain allowlist: add `allowedDomains: string[]` to `GuardrailPolicy`, feed it to the SDK sandbox `network.allowedDomains` in `claudeCodeLoop.ts:215` and to a local egress proxy for the Seatbelt path; until a proxy exists, at least show the field and warn that the direct engine enforces it only via the command rules.
- **claude-code-on-the-web**: No PR deliverable: add an optional wrap-up step (branch per run, `gh pr create` behind a `phase` approval) and surface the PR URL in the EndCard.
- **claude-code-on-the-web**: Git credentials are reachable from the sandbox: deny reads of `~/.ssh` and `~/.git-credentials` in `seatbeltProfile`, and route `git push` through a helper that attaches credentials outside the sandbox.
- **claude-code-on-the-web**: Two runs can target one workspace at once and share `.reins/`: refuse `createRun` while another live run owns the same workspace, or run each trial in a fresh worktree.
- **claude-code-on-the-web**: No remote execution target: the `LoopOptions`/`ToolContext` seam (`loop.ts:29-40`, `registry.ts:15-24`) is where an SSH or container executor would plug in; document it as out of scope or add it.
- **claude-code-on-the-web**: Unified budget: add a Reliability or sidebar tile that sums cost across runs for the day and, on the Claude Code engine, says that usage is counted against the subscription shared with the CLI.
- **claude-code-sandboxing**: No egress proxy or domain allowlist: add `allowedDomains` to `GuardrailPolicy`, pass it to the SDK sandbox in `claudeCodeLoop.ts:215` (today the `network` block is dropped entirely when network is on), and for the direct engine run a local HTTP(S) proxy outside the sandbox with `HTTP_PROXY`/`HTTPS_PROXY` set in `runShell`'s env, raising an `approval.requested` on the first contact with a new domain.
- **claude-code-sandboxing**: Sandbox violations are invisible: when `runShell` output under the sandbox matches "operation not permitted", emit a `guardrail.decision` (or a new `sandbox.violation` event) naming the path or host, render it on the Stage with its own badge, and offer "allow this path for the run".
- **claude-code-sandboxing**: Reads of secrets are open: add `(deny file-read* (subpath "~/.ssh") (subpath "~/.aws") (literal "~/.git-credentials") (subpath "~/.config/gh"))` to `seatbeltProfile`, keeping reads of the rest of the disk open for builds.
- **claude-code-sandboxing**: `confinePath` (`policy.ts:120-127`) should `realpathSync` the deepest existing ancestor of the target and re-check it against the workspace, so a symlink inside the workspace cannot write outside it.
- **claude-code-sandboxing**: The API key re-enters the SDK subprocess environment (`claudeCodeLoop.ts:184`): use the SDK's `CLAUDE_CONFIG_DIR` login only and drop `ANTHROPIC_API_KEY` from the env unless no login exists, or document that on the Claude Code engine the agent's shell can read it.
- **claude-code-sandboxing**: Linux has no sandbox: add a bubblewrap backend to `sandboxArgs` (`bwrap --ro-bind / / --bind <ws> <ws> --unshare-net`) and show `sandboxAvailable` as a badge in New run and Guardrails so a user on Linux knows the switch is inert.
- **claude-code-sandboxing**: Prompt-reduction is unmeasured across runs: add "asked you per 100 tool calls" to `Trial` and the Reliability table so a policy change can be compared between trial sets.
- **claude-think-tool**: Default contradicts the post's 2025-12-15 update: set `thinkTool.defaultOn` to false in `shared/components.ts:153` (or make the Careful profile the only one that turns it on) and record in `assumption` that current models with extended thinking rarely need it.
- **claude-think-tool**: Think rows are not distinct: in `feedGroups.ts` treat `think` as flagged (never grouped) and give it its own collapsible "reasoning" row in `Stage.tsx`, like native thinking.
- **claude-think-tool**: No brainstorm nudge on failure: when `lastEval` exists in `orchestrator.ts:234`, prepend "Before editing, use think to list at least two candidate causes for each failed criterion and pick one."
- **claude-think-tool**: No harness-level "assess before acting": in `loop.ts:402-405`, when a result is truncated or `ok === false` and the next turn's first tool is side-effecting (bash, write_file, edit_file), add a one-line user message asking for a `think` call first.
- **claude-think-tool**: Think usage is unmeasured: count `think` calls per role in `derive.ts` and show "N think calls · M output tokens" on the Context tab so the cost trade-off is visible per run.
- **code-execution-with-mcp**: No data-stays-in-runtime mode: add a `run_script` tool that executes a script under the sandbox and returns only its stdout (capped) while writing the full result to `.reins/out/<id>`, and prompt the builder to use it for large or chained data instead of reading files into context.
- **code-execution-with-mcp**: No PII tokenization: add a pass in `loop.ts:402-405` that replaces e-mail, phone and card patterns in tool results with `[EMAIL_n]` placeholders kept in a per-run map, restoring them when a placeholder appears in a later tool input; make it a `components` switch so it can be ablated.
- **code-execution-with-mcp**: Skills are not written by the agent: add a `save_skill(name, description, body)` tool confined to `.reins/skills/<name>/SKILL.md` and mention it in the BUILDER prompt after a fix round; the Harness Skills list already shows workspace skills.
- **code-execution-with-mcp**: No live logs for long commands: stream `child.stdout` chunks as `tool.progress` events (bounded) so the Stage row can show the tail of a 10-minute test run while it runs.
- **code-execution-with-mcp**: `tool_search_tool_regex` has no detail level: once external MCP servers are allowed (see advanced-tool-use), expose them via the deferred-tool path and record `bytesIn`/`bytesOut` on `tool.result`.
- **code-execution-with-mcp**: The SDK engine drops text beyond 24,000 chars (`claudeCodeLoop.ts:340`) instead of saving it: call `saveFullOutput` there too so the "full output" link works on both engines.
- **confidential-inference-trusted-vms**: Decisions are not all logged: make `gate()` emit a `guardrail.decision` for read-only and in-workspace allows too (`loop.ts:477-480`), so the Guardrails tab is a complete record, and collapse the two gate implementations into one function both engines call.
- **confidential-inference-trusted-vms**: No tamper evidence: add `prevHash`/`hash` (sha256 of the previous line and this one) to every event in `RunBus.emitEvent`, a `GET /api/runs/:id/export` that bundles `events.jsonl`, `config.json`, tool outputs and the prompt texts, and a verifier in `lessons:check` style (`npm run runs:verify`).
- **confidential-inference-trusted-vms**: The key re-enters the agent's environment on the SDK engine (`claudeCodeLoop.ts:184`): prefer the CLI login (`CLAUDE_CONFIG_DIR`) and drop `ANTHROPIC_API_KEY` from `env` when a login exists.
- **confidential-inference-trusted-vms**: No production mode: add `guardrail.mode: "production"` that rejects `trust`, custom allow patterns and `allowNetwork` on the direct engine, shows a badge in `RunHeader`, and is the default for saved presets marked `shared`.
- **confidential-inference-trusted-vms**: Trace lacks tool and skill provenance: hash each tool schema and each skill body read, and record `toolsHash`, `skillsHash`, `stageLessonsHash` in the request-shape note so a run can be checked against what should have been running.
- **confidential-inference-trusted-vms**: Egress is unmeasured: when a local proxy exists (see the sandboxing audit) log destination and bytes per run as `note` events and show totals on the Guardrails tab.
- **confidential-inference-trusted-vms**: Name the trust boundary: add a `trustedCore` foundation to `shared/components.ts` listing the modules it covers (policy, classifier, bus, scrubbedEnv, confinePath) and keep those files free of tool execution so a reviewer knows what to read.
- **demystifying-evals-for-ai-agents**: Trials are not isolated: give `repeat()` a `fresh: true` option that runs each trial in `git worktree add` of the base commit with an empty `.reins/`, and label trial sets as "shared workspace" vs "fresh" so the two are not mixed.
- **demystifying-evals-for-ai-agents**: No deterministic grading: when a criterion's `verify` is a shell command, have the orchestrator run it itself after `report_evaluation` and record `observedExit`/`observedOutput` next to the evaluator's `pass`; disagreement becomes a visible "grader vs harness" row.
- **demystifying-evals-for-ai-agents**: No "unknown" or "grader wrong": extend `CriterionResult` with `outcome: "pass" | "fail" | "unknown"` and `disputed?: string`, let the evaluator mark unknown, and let the user flag a result on the Contract tab (stored as a `note` event) so the Reliability set can show disputed trials.
- **demystifying-evals-for-ai-agents**: No broken-task signal: in `groupTrials`, when `n ≥ 3` and `passes === 0`, add `flag: "probably-broken"` and render "0 of n passed: check the task and criteria before blaming the agent" on the Reliability card.
- **demystifying-evals-for-ai-agents**: No suites or graduation: add `$REINS_HOME/suites/<name>.json` (task, workspace, expected pass rate) with a "Run suite" action and a `regression` badge once a set's pass rate stays above a threshold for N trials.
- **demystifying-evals-for-ai-agents**: No task bank from failures: add "Save as eval task" on a failed run's EndCard that writes the task, workspace and contract to a suite file.
- **demystifying-evals-for-ai-agents**: Trial metrics are thin: add `turns`, `toolCalls` and `firstTurnMs` to `trialFromEvents` and the Reliability table.
- **desktop-extensions**: Workspace skills are trusted silently: ask once per workspace before indexing `.reins/skills` and `.claude/skills` (approval kind `skill`), and let `$REINS_HOME/settings.json` carry `skills.block: string[]` and `skills.allowWorkspace: boolean`.
- **desktop-extensions**: No skill manifest or lint: add `version:` and `requires:` (tools it expects, e.g. `bash`) to `SKILL.md` frontmatter, show them on the Skills card, and extend `lessons:check` to a `skills:check` that fails on a missing description or an unknown required tool.
- **desktop-extensions**: Secrets in a plain file: store the API key with the macOS `security` CLI (or `keytar`) when available and keep `settings.json` as the fallback, saying which is in use in Settings.
- **desktop-extensions**: Sandbox availability is invisible: render `info.sandboxAvailable` in New run next to the OS sandbox switch ("inert on this platform") and in the Guardrails tile.
- **desktop-extensions**: Formats are unversioned: add `schemaVersion` to `events.jsonl` lines (or the first event), `config.json` and `presets.json`, and document them in `docs/configuring.md`.
- **effective-context-engineering-for-ai-agents**: Compaction is not tunable: add `context.preserve: string` (free text) to `RunConfig`, pass it as the compaction instruction when the API accepts one, and include it in the reset handoff; show the compaction summary in an editable textarea on the Context tab when the run is paused.
- **effective-context-engineering-for-ai-agents**: Reset threshold uses a string-length estimate: keep the last measured `promptTokens` per role from `context.snapshot` and compare that in `shouldResetBuilder` (`orchestrator.ts:289`).
- **effective-context-engineering-for-ai-agents**: The SDK engine's composition is fabricated (`claudeCodeLoop.ts:278`): either omit `composition` (make it optional) and show only the measured total, or estimate from the recorded tool results like the direct engine does.
- **effective-context-engineering-for-ai-agents**: No per-call context cost: add `estimateTokens(output)` to `tool.result` and show it on the CallRow so a 20k-token `cat` is visible as such.
- **effective-context-engineering-for-ai-agents**: Tool overlap is unlinted: add a registry test that fails when two tool descriptions share more than N content words or two tools accept the same parameter under different names (`path` vs `file`).
- **effective-context-engineering-for-ai-agents**: No strategy selection: in `checkRunConfig`, warn when compaction, reset and scouts are all on for a short task (budget < $3 or Minimal), and add a one-line "context strategy" readout to the Context tab naming which of the three is active.
- **effective-harnesses-for-long-running-agents**: Titles of existing features are editable: in `mergeFeatures`, keep the stored `title` for a known id and only accept `status` and `note` changes, emitting a warn note when the agent tried to rename or drop one.
- **effective-harnesses-for-long-running-agents**: No `init.sh`: have the planner write `.reins/init.sh` (how to install, run and smoke-test), run it in `Orchestrator.run` before each build phase with a timeout, and log its output as a `note`; the builder's preamble then starts from a known-good state.
- **effective-harnesses-for-long-running-agents**: One build phase does all features: add `buildMode: "one-feature-per-session"` that ends the build loop after each feature flips to done (fresh conversation, commit, progress note) and loops until the list is done or the budget is spent.
- **effective-harnesses-for-long-running-agents**: `finish` accepts a dirty tree: when `gitCommits` is on, run `git status --porcelain` in the `finish` handler and return the dirty list instead of finishing.
- **effective-harnesses-for-long-running-agents**: No browser verification: add a deferred `screenshot(url)` / `browse(url, steps)` tool (Playwright) for the builder and evaluator when a contract names a URL, and let the `verify-like-a-user` skill say what it cannot see (native dialogs, downloads).
- **effective-harnesses-for-long-running-agents**: Startup routine is advisory: inject the last 40 lines of `progress.md` and `git log --oneline -20` into the build phase's first message (`projectContext()`), so the routine does not depend on the model remembering to read them.
- **enabling-claude-code-to-work-more-autonomously**: No checkpoints: before each `write_file`/`edit_file` (and in `canUseTool` for Write/Edit on the SDK engine) copy the previous content to `$REINS_HOME/runs/<id>/checkpoints/<seq>/<path>` and emit `file.checkpoint`; add a "Restore files to here" action on the scrubber that writes them back, leaving the conversation untouched, and say on the card that shell side effects are not restored.
- **enabling-claude-code-to-work-more-autonomously**: No managed background processes: add `start_process(command)` / `stop_process(id)` tools that keep a child alive for the phase, stream its tail into `tool.progress` events, and kill it at phase end; the Stage shows a "running processes" strip.
- **enabling-claude-code-to-work-more-autonomously**: No user hooks: support `.reins/hooks.json` (`afterEdit`, `beforeCommit`, `beforeFinish` commands with timeouts) executed by the orchestrator, each result logged as a `note` and a failing `beforeFinish` returned to the builder instead of finishing.
- **enabling-claude-code-to-work-more-autonomously**: Scouts are not available on the SDK engine: implement `delegate_scout` there with a nested `query()` using read-only tools, returning only the final text, so both engines share the component.
- **enabling-claude-code-to-work-more-autonomously**: No steer history: keep the last 20 operator notes per browser in `localStorage` and cycle them with the up arrow in the steer box; show the feed's past notes as suggestions.
- **enabling-claude-code-to-work-more-autonomously**: Diffs are per phase: emit `files.changed` after every write tool call (cheap `git diff --numstat` on the touched path) so the Changes tab updates per edit.
- **eval-awareness-browsecomp**: No budget-anomaly signal: compute the median `costUsd` per trial set in `allTrialSets` and have the Stage emit a warn note when a live run of that task passes 3x it (the Overview meter already knows the budget fraction).
- **eval-awareness-browsecomp**: No strategy-drift detection: check `search`/`WebSearch`/`http_fetch` inputs for off-task terms ("benchmark", "evaluation", "decrypt", "answer key") and emit a warn note that badges the call.
- **eval-awareness-browsecomp**: Deliverable type unchecked: add an optional `deliverable` (file path, HTTP response or text answer) to the contract and have the evaluator fail the round when `finish` produced something else.
- **eval-awareness-browsecomp**: Content filter is injection-only and the SDK engine does not wrap: add `guardrail.contentDenyPatterns` applied to every tool result in both engines, wrapping in `<untrusted_tool_output>` at `claudeCodeLoop.ts:338` as the direct engine does.
- **eval-awareness-browsecomp**: Denial escalation is missing on the SDK engine: add the consecutive/total counter from `noteDenial` to `canUseTool`.
- **eval-awareness-browsecomp**: Scout dispatch is never gated or capped: classify the scout question in auto mode, cap scouts per turn and per phase in `AgentLoop.scout`, and map SDK `parent_tool_use_id` messages to a scout role instead of dropping them.
- **eval-awareness-browsecomp**: Trials share `.reins/` state: offer "fresh `.reins/` per trial" (or a git worktree per trial) in `repeat()` so repeated trials are independent.
- **eval-awareness-browsecomp**: No flagged-run concept: a `flag` note (reason + seq) settable from the Stage, filterable in Reliability, with a "re-run flagged" button.
- **eval-awareness-browsecomp**: No content blocklist: covered by `contentDenyPatterns` above; version it in the run config so a re-run records which list it used.
- **harness-design-long-running-apps**: Reset fires only at round boundaries: compare `promptTokens` from each `context.snapshot` with `resetAtTokens` inside `AgentLoop.run`, end the phase with a `reset` reason and let the orchestrator restart the builder from `progress.md` mid-build.
- **harness-design-long-running-apps**: Cost per phase is hidden: render `PhaseStat.costUsd` next to the elapsed time in `PhaseStepper` and on the phase FeedRow's finished line.
- **harness-design-long-running-apps**: No browser evidence: a deferred Playwright `screenshot`/`browse` tool for the evaluator when a criterion's verify step names a URL, with the image shown in the Stage.
- **harness-design-long-running-apps**: No evaluator calibration: let `report_evaluation` take an optional 0-1 score per criterion and ship two `input_examples` (a specific FAIL with quoted output, a PASS) so the rubric stays stable across rounds.
- **harness-design-long-running-apps**: Prompts are not tunable: expose `systemPromptFor` templates as editable, hash-versioned text (`$REINS_HOME/prompts/<role>.md` overrides shown in the Harness tab) so evaluator calibration is a product action.
- **harness-design-long-running-apps**: Evaluator cost is invisible: render `costByRole` on the EndCard and hint when the evaluator cost more than the build and passed in round 1.
- **how-anthropic-teams-use-claude-code**: No attachments: accept `attachments: {name, mime, base64}[]` on `POST /api/runs`, store them under the run dir, pass images as image blocks and text as an "# Attachments" section in `firstMessage`.
- **how-anthropic-teams-use-claude-code**: Knowledge layer is read-only in practice: at wrapup instruct the builder (or offer an `update_project_notes` tool) to append conventions it learned to CLAUDE.md/AGENTS.md, gated by the commit pause.
- **how-anthropic-teams-use-claude-code**: No visual evidence: a Playwright `screenshot` tool for the builder and evaluator (shared with the harness-design gap).
- **how-anthropic-teams-use-claude-code**: One-shot mode still needs setup: a "Quick task" entry that creates a temporary workspace and starts from Minimal.
- **how-anthropic-teams-use-claude-code**: Subagents cannot be defined: let `.reins/agents/<name>.md` (prompt plus allowed read-only tools) register as a deferred `delegate_<name>` tool reusing `AgentLoop.scout`.
- **how-anthropic-teams-use-claude-code**: No CLI or CI entry: `reins run --task --workspace --json` over `RunManager` streaming events as JSONL, plus a sample GitHub Action.
- **how-anthropic-teams-use-claude-code**: No codebase Q&A outside a run: an "Ask the codebase" box that runs one scout with the direct client and shows the answer.
- **how-anthropic-teams-use-claude-code**: No PR automation: an optional wrapup step `gh pr create` behind a phase approval.
- **how-we-contain-claude**: Domain allowlist: `guardrail.allowedDomains: string[]` passed to the SDK `network.allowedDomains` and checked by `http_fetch` and the intake fetch; since Seatbelt cannot filter by host, keep shell network off whenever a list is set or route it through a local proxy.
- **how-we-contain-claude**: Credentials readable from the sandbox: add `(deny file-read* (subpath "~/.aws") (subpath "~/.ssh") (literal "~/.netrc") ...)` to the Seatbelt profile and a read-deny list in `confinePath`.
- **how-we-contain-claude**: No trust prompt: ask once per new workspace (approval kind `workspace`) before CLAUDE.md, `.claude/skills` and `.reins/*` are read, and record the decision in `settings.json`.
- **how-we-contain-claude**: `confinePath` is lexical: `realpathSync` the deepest existing ancestor of `abs` and re-check it under `realpathSync(workspace)`; fix the comment.
- **how-we-contain-claude**: No filesystem modes: `guardrail.fs: "rw" | "ro" | "rw-no-delete"` honoured by `write_file`/`edit_file` and a DENY on `rm` in `classifyBash`.
- **how-we-contain-claude**: Output inspection is regex-only and the SDK engine does not wrap: on a sniff hit run a one-shot classifier call over the output and wrap it in both engines.
- **how-we-contain-claude**: No egress record: log the host of every `http_fetch`/`WebFetch` and of `curl`/`wget` commands into a `network.access` note shown on the Guardrails tab.
- **how-we-contain-claude**: Persistent-state provenance: run `sniffInjection` over CLAUDE.md, AGENTS.md and `progress.md` at load and label the "Project notes" section with its source path.
- **how-we-contain-claude**: Local server is unauthenticated: bind to 127.0.0.1 and require a per-start token (printed at startup, held by the web app) on every mutating route.
- **infrastructure-noise**: Environment note lacks infra facts: add `os.cpus().length`, `os.totalmem()`, the shell timeout, concurrency (always 1 today) and `process.resourceUsage()` at the end of the run, and copy them onto `Trial`.
- **infrastructure-noise**: No infra bucket: add `Trial.failureKind: "agent" | "infra" | "none"` derived from the last `error` (API or connection error, shell timeout, interrupted) and show an infra error rate next to the pass rate.
- **infrastructure-noise**: No resource limits: run `bash` under `ulimit -v`/`-t` (or `prlimit` on Linux) from `guardrail.limits {memMb, cpuSec}` with a separate soft warning threshold, and warn in `checkRunConfig` when soft equals hard.
- **infrastructure-noise**: No interval: show a Wilson 95% interval next to the pass rate when n < 30 and grey out pass^k when the interval is wider than 0.3.
- **infrastructure-noise**: No config match: split or badge trial sets when model, engine, harness version or effort differ, and add a "diff configs" link between two trials using `diffFromDefaults`.
- **infrastructure-noise**: No time view: plot trial outcome against the hour of `createdAt` and mean turn latency (`turn.started` to `turn.finished`) in Reliability.
- **infrastructure-noise**: No resource trace: record per-tool `durationMs` sums and the shell child's peak RSS (`/usr/bin/time -l`) on `tool.result`.
- **infrastructure-noise**: Timeouts are untyped: set a `timedOut` field on `tool.result` (or a warn note) so they can be counted as infra.
- **managed-agents**: The harness holds state: persist `builderHistory` (direct) or `builderSession` (SDK), `features` and `contract` to the run dir after each phase so an `Orchestrator` can be rebuilt from disk and the log is the only state.
- **managed-agents**: No resume: add `RunManager.resume(runId)` that rebuilds the orchestrator from the saved phase state and continues at the last `phase.started`, instead of `markInterrupted` failing the run.
- **managed-agents**: The agent cannot reread the session: a deferred `read_log(from, to)` tool returning narrated events from the run's JSONL, filtered to the caller's role.
- **managed-agents**: Credentials in the SDK hand: pass `ANTHROPIC_API_KEY` to the subprocess only when no Claude Code login exists, point `CLAUDE_CONFIG_DIR` at a scoped copy, and document that the SDK Bash tool inherits the user's files.
- **managed-agents**: No failure taxonomy: add `kind: "model" | "tool" | "transport" | "harness"` to the `error` event and set it at each emit site; filter by it in the Transcript.
- **managed-agents**: Which hand is invisible: add `sandboxed: boolean` to `tool.result` from `ToolContext.sandbox` and badge it in `CallRow`.
- **managed-agents**: One brain per process: allow parallel repeats when each trial gets its own `git worktree`, with a per-workspace lock otherwise.
- **multi-agent-research-system**: Brief schema: extend `delegate_scout` input to `{objective, output_format, sources, boundaries}` (keep `question` as a shorthand) and render the fields in the Stage narration.
- **multi-agent-research-system**: Scout fan-out is unbounded: cap scouts per turn (3) and per phase (8) in `AgentLoop.scout` and show a scout count on the phase row.
- **multi-agent-research-system**: No artifact references: let a scout write its full findings to `.reins/scouts/<id>.md` and return the path plus a five-line summary, linked from the CallRow.
- **multi-agent-research-system**: No mid-run resume: persist phase state and add `RunManager.resume(runId)` (see the managed-agents audit).
- **multi-agent-research-system**: Batch join: run scouts with `Promise.allSettled` and attach late answers as a user block on the next turn (an inbox) instead of blocking the turn.
- **multi-agent-research-system**: No rubric or task library: add a fixed evaluator rubric (correctness, completeness, evidence quality, source quality, efficiency) scored 0-1 alongside per-criterion pass/fail in `report_evaluation`, and `~/.reins/tasks/*.md` for repeat trials.
- **multi-agent-research-system**: Tool descriptions are untested: a `registry.test.ts` case per tool (description length, examples for array-of-object inputs) and a `tool-eval` script that feeds a trial set's transcripts back to the model for description edits.
- **multi-agent-research-system**: No privacy view: `GET /api/runs/:id/events?shape=1` that strips `text`, `thinking`, `input` and `output` to types, names and durations.
- **multi-agent-research-system**: Steer during a scout goes to the scout: give the scout its own `LoopControl` with an empty `drainSteer` so operator notes reach the builder.
- **redesigning-source-control**: No bisect or revert: a deferred `git_revert_to_base` (reset to the run's `baseSha` behind an approval) and a `git_bisect` helper the fix round can call when the same hard criterion fails twice.
- **redesigning-source-control**: No post-merge signal: an optional wrapup step that reruns the contract's hard `verify` commands after the final commit and records a `postmerge.result` event.
- **redesigning-source-control**: No semantic change classes: classify `files.changed` by extension and diff shape (docs-only, tests-only, logic) and show the class on the Files tab and the EndCard.
- **redesigning-source-control**: Findings cannot be dismissed with a reason: in the after-evaluation approval allow "accept despite FAIL", recording the note and marking the round `overruled`.
- **redesigning-source-control**: No path constraints: `guardrail.protectedPaths: string[]` (globs) enforced in `confinePath` for writes and in `classifyBash` as an ask when mentioned.
- **redesigning-source-control**: No monitoring agent: a scheduled read-only scout over the last N runs' logs that posts a `note` on anomalies (error rate or cost drift) to the Reliability tab.
- **redesigning-source-control**: Artifacts are not content-addressed: name saved tool outputs by the sha256 of their content and add a per-line hash chain to the JSONL export.
- **swe-bench-sonnet**: `write_file` overwrites: require `overwrite: true` to replace an existing file and return "exists; pass overwrite:true or use edit_file".
- **swe-bench-sonnet**: No reproduction evidence: add a build-stage line "write a script that reproduces the failure, run it, fix, rerun" and have the evaluator's `evidence` carry before/after output, shown as a pair on the Contract tab.
- **swe-bench-sonnet**: Failure kinds are not separated: `Trial.failureKind` as in the infrastructure-noise audit.
- **swe-bench-sonnet**: No image viewing on the direct engine: a `view_image` tool returning an image content block for PNG/JPEG files under the workspace, size-capped.
- **swe-bench-sonnet**: Tests are editable: record the test files named in contract `verify` commands at `contract.agreed` and have the evaluator fail the round when `git diff --name-only <baseSha>` includes them without a criterion allowing it.
- **swe-bench-sonnet**: Shell state does not persist and the description is silent: say so in the `bash` description ("each call starts a fresh shell in the workspace; chain with && or cd inside the command").
- **swe-bench-sonnet**: SDK truncation has no hint: reuse `truncate()` from `registry.ts` at `claudeCodeLoop.ts:340`.
- **writing-tools-for-agents**: No tool eval loop: a `scripts/tool-eval.ts` that folds a trial set's `tool.called`/`tool.result` events into per-tool count, error rate, mean duration and result size, and a "Tools" table in the Harness tab from the same fold in `derive.ts`.
- **writing-tools-for-agents**: No registry lint: a `registry.test.ts` case that fails on descriptions under 40 characters, tools with array-of-object inputs and no example, and two tools whose descriptions share most of their words.
- **writing-tools-for-agents**: No annotations: add `destructive` and `openWorld` to `ToolDef` (`write_file`, `edit_file`, `bash`, `git_commit` destructive; `http_fetch` open-world), pass them as MCP annotations in `mcpServer()`, badge them in `CallRow` and gate open-world tools on `allowNetwork`.
- **writing-tools-for-agents**: Two names per tool: prefix direct-engine tool names consistently (or strip `mcp__reins__` in `narrateToolCall` and the Guardrails table) so the Stage shows one name on both engines.
- **writing-tools-for-agents**: No per-tool metrics: covered by the tool eval fold above.
- **writing-tools-for-agents**: No `response_format`: add `format: "concise" | "detailed"` to `git_status`, `list_files` and `search` (concise is paths only).
- **writing-tools-for-agents**: SDK truncation has no hint: reuse `truncate()` at `claudeCodeLoop.ts:340`.
