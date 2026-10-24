# Code execution with MCP: Building more efficient agents
Source: https://www.anthropic.com/engineering/code-execution-with-mcp
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Expose tools as a typed code API discoverable by ls/cat; only used definitions enter context | Tool search with `defer_loading` (`loop.ts:103-106`) keeps rarely used tools out of the prompt; no code API over tools | partial |
| Sandboxed code execution where tool results are data, not context | The agent can write and run scripts via bash under Seatbelt (`registry.ts:246`, `sandbox.ts`); results still return through context, capped at 24K chars (`registry.ts:12`) | partial |
| PII tokenization at the harness boundary with data-flow rules | Not implemented | gap |
| Persistent workspace and a skills directory the agent can save to and the user can browse | `.reins/` notes per workspace; skills loaded from `.reins/skills` and `~/.reins/skills` (`server/src/skills.ts:45`); agents do not write skills | partial |
| Polling and loop logic inside the sandbox; UI shows one running-script step with live logs | Bash runs loops; the Stage shows one row per call with its output (`Stage.tsx` CallRow); no live log streaming | partial |
| Keep direct calls for simple cases and show which mode is in use | Dedicated tools for reads/edits plus bash for breadth (`registry.ts:125-262`); the feed names the tool used | implemented |
| Audit code executions: code, invocations, bytes in and out, what entered context | Every call logs input, output, duration and truncation (`tool.called`/`tool.result` in `shared/types.ts`); full output kept on disk (`loop.ts:504`) | implemented |

## Gaps
- Generate a `servers/<name>/<tool>.ts` style shim for MCP servers once MCP integration lands (see advanced-tool-use gaps); the registry already carries schemas.
- Let the builder save a skill (`.reins/skills/<slug>/SKILL.md`) via a `save_skill` tool after a fix round, and list workspace skills in the Harness tab.
