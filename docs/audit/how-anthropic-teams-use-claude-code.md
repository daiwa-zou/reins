# How Anthropic teams use Claude Code
Source: https://www.anthropic.com/news/how-anthropic-teams-use-claude-code
Lesson file checked against the original: yes (nothing missing; the /news/ URL redirects to claude.com/blog)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Support tight pairing and "delegate, check in periodically", surfacing the check-in points | Pauses after plan, contract, before commit, after evaluation (`shared/types.ts:74-79`; `server/src/engine/orchestrator.ts:172-176,212-216,301-304,265-268`); Careful vs Full presets (`shared/config.ts:96-118`); steer box (`web/src/panels/Stage.tsx:119-131`); "Needs you" banner (`Stage.tsx:51-70`) | implemented |
| Screenshots and pasted logs as first-class inputs | The task is one string (`shared/types.ts:111`); `POST /api/runs` takes text only (`server/src/index.ts:198-213`); no attachments, no image blocks | gap |
| Make read-only exploration cheap and safe; a project knowledge layer the agent reads and writes | Read-only tools run in parallel without approval (`server/src/engine/loop.ts:297-301,477`; `server/src/tools/registry.ts:149,224,244`); scouts (`loop.ts:453-468`); `projectMemory` hands CLAUDE.md/AGENTS.md to every role (`orchestrator.ts:50-58`). The harness writes only `progress.md` (`orchestrator.ts:81,278-280`); nothing asks the agent to update CLAUDE.md | partial |
| Autonomous build/test/iterate against a design artifact, with visual diff evidence | Build, evaluate and fix rounds (`orchestrator.ts:230-271`); no image input and no screenshot output | partial |
| Non-engineers use the same harness: sandboxed one-shot mode with sensible defaults | Minimal preset (`shared/config.ts:98-105`), `defaultRunConfig` (`shared/components.ts:343-372`), Seatbelt on by default (`shared/components.ts:222-232`), plain-language narration (`shared/narrate.ts`); still needs a workspace path and a key or CLI (`index.ts:198-202`) | partial |
| Specialized subagents with narrow prompts, easy to define and reuse | One fixed scout with a hardcoded prompt (`loop.ts:456-463`); roles are fixed (`shared/types.ts:5`); skills are the reusable unit (`server/src/skills.ts:48-57`) but are procedures, not agents | partial |
| CI integration, headless mode and event-triggered runs | HTTP + WebSocket API drives runs without the UI (`index.ts:198-213,331-375`); no CLI, no JSONL to stdout, no Action; the repo's CI only typechecks, tests and builds (`.github/workflows/ci.yml:1-13`) | partial |
| CLAUDE.md as the onboarding and codebase map | `projectMemory` component (`shared/components.ts:78-88`); CLAUDE.md and AGENTS.md read per phase, truncated at 6000 chars with a warning (`orchestrator.ts:50-58`) | implemented |
| Pseudocode first, then TDD, with periodic check-ins | Planner spec (`server/src/roles/prompts.ts:20-27`) and the contract before code (`orchestrator.ts:181-226`) are the pseudocode-first steps; the plan and contract pauses are the check-ins | implemented |
| Thought partner: ask which files to examine for a bug or feature | Scouts answer codebase questions for the builder (`registry.ts:360-367`); no user-facing "ask the codebase" without starting a run | partial |
| Automated PR comments and test refactoring via Actions | None; `gitCommits` commits locally (`orchestrator.ts:298-312`) and `git push` is an ASK rule (`server/src/guardrails/policy.ts:54`) | gap |
| Hand over abstract problems, review the result before final refinement | `reviewIntent` foundation (`shared/components.ts:311-316`): contract and evidence (`web/src/panels/Contract.tsx:6-78`), diffs on demand (`web/src/panels/Files.tsx:8-75`) | implemented |
| Runbooks and ingested docs reused as debugging context | Skills layer with on-demand bodies (`skills.ts:48-57`; `registry.ts:348-358`); the lesson library is readable by agents (`registry.ts:320-346`) | implemented |

## Gaps
- No attachments: accept `attachments: {name, mime, base64}[]` on `POST /api/runs`, store them under the run dir, pass images as image blocks and text as an "# Attachments" section in `firstMessage`.
- Knowledge layer is read-only in practice: at wrapup instruct the builder (or offer an `update_project_notes` tool) to append conventions it learned to CLAUDE.md/AGENTS.md, gated by the commit pause.
- No visual evidence: a Playwright `screenshot` tool for the builder and evaluator (shared with the harness-design gap).
- One-shot mode still needs setup: a "Quick task" entry that creates a temporary workspace and starts from Minimal.
- Subagents cannot be defined: let `.reins/agents/<name>.md` (prompt plus allowed read-only tools) register as a deferred `delegate_<name>` tool reusing `AgentLoop.scout`.
- No CLI or CI entry: `reins run --task --workspace --json` over `RunManager` streaming events as JSONL, plus a sample GitHub Action.
- No codebase Q&A outside a run: an "Ask the codebase" box that runs one scout with the direct client and shows the answer.
- No PR automation: an optional wrapup step `gh pr create` behind a phase approval.
