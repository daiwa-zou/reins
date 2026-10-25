# Writing effective tools for AI agents, with agents
Source: https://www.anthropic.com/engineering/writing-tools-for-agents
Lesson file checked against the original: yes (nothing missing)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Cap tool results and, when truncating, say how to narrow the request | `MAX_RESULT_CHARS` 24,000 with head/tail and a hint (`server/src/tools/registry.ts:13,57-65`); shell capture capped (`registry.ts:103-105`); full output kept on disk (`server/src/engine/loop.ts:403,504-512`) and linked from the CallRow (`web/src/panels/Stage.tsx:443-450`); the SDK engine slices without a hint (`server/src/engine/claudeCodeLoop.ts:340`) | implemented |
| Tool descriptions and example inputs are among the most effective levers | `toolExamples` switch (`shared/components.ts:167-177`; `loop.ts:102`); `input_examples` on `edit_file`, `bash`, `propose_contract` (`registry.ts:183,260,390-400`); descriptions written as onboarding text (`registry.ts:249,362`) | implemented |
| More tools is not better: keep the loaded set small, find the rest on demand | `toolSearch` (`shared/components.ts:156-166`); `defer_loading` on git, fetch and lesson tools (`registry.ts:299,305,311,318,331,346`; `loop.ts:103-106`); `tools.loaded` events (`loop.ts:286-292`) shown on the Context tab (`web/src/panels/Context.tsx:54-62`); 21 tools in total (`registry.ts:469-474`) | implemented |
| Commands that can print a lot get pagination, filtering or truncation defaults (build stage) | Delivered as a "Lessons for this stage" line in the build phase's first message (`server/src/roles/prompts.ts:93-97`; `shared/implications.ts:63-80`) | implemented |
| Return meaningful names rather than raw IDs from the tools you build (build stage) | Same stage-lesson mechanism (`prompts.ts:93-97`) | implemented |
| Each criterion has a verifiable outcome that does not fail on formatting (contract stage) | Contract stage lesson plus `criterionSchema` requiring `verify` (`registry.ts:371-381`); the contract evaluator removes vague criteria (`prompts.ts:57`) | implemented |
| Exercise the tool on realistic tasks and data, not a toy sandbox (evaluate stage) | Evaluate stage lesson; EVALUATOR "Test as a user would" (`prompts.ts:44`); `skills/verify-like-a-user/SKILL.md` | implemented |
| Tool eval workflow: run tasks, collect accuracy, runtimes, call counts, tokens and error rates, paste transcripts back to refactor tools | Trial sets and repeats collect runs (`server/src/engine/trials.ts`; `server/src/engine/runManager.ts:292-305`); transcripts are only reachable as raw events (`server/src/index.ts:197`); no per-tool call count, error rate or duration anywhere, no refactor loop | gap |
| Lint the registry for namespacing and overlapping tools | `tool()` builds strict schemas (`registry.ts:35-55`); `registry.test.ts` tests `truncate` and `scrubbedEnv` only (`server/src/tools/registry.test.ts:5-27`); no lint of names, descriptions or overlap | gap |
| Show tool annotations (read-only, destructive, open-world) and use them for permission gating | `ToolDef.readOnly` drives parallelism and auto-allow (`registry.ts:30-31`; `loop.ts:298-301,477`); no destructive or open-world flags; the UI shows guardrail verdicts, not annotations (`Stage.tsx:410-424`); the MCP server passes no annotations (`claudeCodeLoop.ts:60-63`) | partial |
| Consolidate: do not wrap endpoints; prefer search over list | `search` (regex, capped) and `list_files` (glob, capped) instead of dumps (`registry.ts:186-245`); `git_status` bundles status and recent log (`registry.ts:296-299`) | implemented |
| Namespace tools by service and resource | Direct-engine names are bare (`read_file`, `bash`, `list_lessons`) while the SDK engine shows `mcp__reins__*` (`claudeCodeLoop.ts:201,317-318`), so the same tool has two names across engines | partial |
| Errors must be actionable with correctly formatted examples, not opaque codes | `edit_file` errors say what to do (`registry.ts:178-179`); unknown tool points to tool search (`loop.ts:407`); denial messages name the rule and suggest another way (`loop.ts:414,421`); path errors (`server/src/guardrails/policy.ts:124`) | implemented |
| Strict data models and unambiguous parameter names | `strict: true` and `additionalProperties: false` (`registry.ts:47-48`); zod shapes for the SDK (`claudeCodeLoop.ts:394-421`); `old_text`/`new_text`, `offset`/`limit` | implemented |
| Collect per-tool metrics: runtime per call, total calls, tokens, tool error rate | `durationMs` per call (`loop.ts:404`), usage per turn (`loop.ts:235`), cost per role derived (`web/src/state/derive.ts:166`); no per-tool aggregates in any view | partial |
| A `response_format` enum (concise/detailed) so the agent chooses verbosity | `offset`/`limit` on `read_file`, `limit` on `list_files` and `search` (`registry.ts:130-132,189,230`); no concise/detailed switch | partial |
| Have agents reason before tool calls; interleaved thinking shows why a tool was or was not called | Adaptive thinking recorded per turn (`loop.ts:253-255,328`); think tool (`registry.ts:263-270`) | implemented |

## Gaps
- No tool eval loop: a `scripts/tool-eval.ts` that folds a trial set's `tool.called`/`tool.result` events into per-tool count, error rate, mean duration and result size, and a "Tools" table in the Harness tab from the same fold in `derive.ts`.
- No registry lint: a `registry.test.ts` case that fails on descriptions under 40 characters, tools with array-of-object inputs and no example, and two tools whose descriptions share most of their words.
- No annotations: add `destructive` and `openWorld` to `ToolDef` (`write_file`, `edit_file`, `bash`, `git_commit` destructive; `http_fetch` open-world), pass them as MCP annotations in `mcpServer()`, badge them in `CallRow` and gate open-world tools on `allowNetwork`.
- Two names per tool: prefix direct-engine tool names consistently (or strip `mcp__reins__` in `narrateToolCall` and the Guardrails table) so the Stage shows one name on both engines.
- No per-tool metrics: covered by the tool eval fold above.
- No `response_format`: add `format: "concise" | "detailed"` to `git_status`, `list_files` and `search` (concise is paths only).
- SDK truncation has no hint: reuse `truncate()` at `claudeCodeLoop.ts:340`.
