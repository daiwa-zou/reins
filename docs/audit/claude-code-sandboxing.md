# Beyond permission prompts: making Claude Code more secure and autonomous
Source: https://www.anthropic.com/engineering/claude-code-sandboxing
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Native OS-level sandbox for the shell tool covering all subprocesses | `server/src/tools/sandbox.ts:21` Seatbelt profile; `registry.ts:90` wraps bash under it when the osSandbox component is on; SDK engine maps it to `claudeCodeLoop.ts:215` | implemented |
| Pair filesystem isolation with network isolation | `sandbox.ts:43-44` denies network and non-workspace writes together; probed in `server/src/tools/sandbox.test.ts` | implemented |
| Route egress through a proxy outside the sandbox with domain allowlists and new-domain confirmations | No proxy; network is all-or-nothing per run (`GuardrailPolicy.allowNetwork`) | gap |
| Turn sandbox violations into specific prompts and boundary events in the UI | `registry.ts:246` bash tool appends a sandbox hint when a command fails with 'operation not permitted'; not a distinct event type | partial |
| Both boundaries configurable per project with a simple enable switch | osSandbox is a per-run component switch (`shared/components.ts:11` COMPONENTS); paths are fixed to workspace + temp + caches (`sandbox.ts:26-38`) | partial |
| Credentials outside the sandbox; privileged git operations via a scoped proxy | `registry.ts:71` scrubbedEnv; pushes need approval (`policy.ts:25`); no credential proxy | partial |
| Same sandbox for MCP servers and subagents | Scouts (`loop.ts` scout) use read-only tools only; the SDK engine passes `sandbox` to the whole session (`claudeCodeLoop.ts:215`) | partial |
| Measure and display the reduction in permission prompts | Guardrails tab counts decisions by verdict and source (`web/src/panels/Guardrails.tsx:7`), including how many asked you | implemented |

## Gaps
- Add a domain allowlist and raise an approval on first contact with a new domain; a local proxy would be the clean implementation.
- Emit a dedicated `sandbox.violation` event (path or host, tool) so the Stage can show boundary events apart from permission prompts.
- Let the run config add writable paths for the sandbox (monorepo caches, build dirs).
