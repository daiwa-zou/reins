# Scaling Managed Agents: Decoupling the brain from the hands
Source: https://www.anthropic.com/engineering/managed-agents
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Session (durable log), harness (stateless loop) and sandbox as separable concerns | Log in `runStore.ts:28`; loops in `loop.ts`/`claudeCodeLoop.ts`; tools in `registry.ts` behind a `ToolContext` | implemented |
| The session log is the source of truth, queryable for resume, rewind, reread | UI and summaries fold the JSONL (`derive.ts:87`, `runStore.ts:61`); scrubber rewinds (`Transcript.tsx:47`); mid-run resume is not supported | partial |
| Uniform tool interface so new hands plug in | `ToolDef.run(input, ctx) -> string` (`registry.ts`); the SDK engine maps the same structured tools through MCP (`claudeCodeLoop.ts:94`) | implemented |
| Infrastructure failures as tool errors the agent can handle; crash recovery by replay | Tool errors return `is_error` results (`loop.ts` execute); orphaned runs are marked interrupted at startup (`runManager.ts:46`) rather than resumed | partial |
| Credentials out of the sandbox | `registry.ts:71` scrubbedEnv | implemented |
| Lazy provisioning to cut time to first token | No provisioning step; shells spawn per call | implemented |
| Failure-localizing observability | `error` events carry recoverable flag and detail; request-shape notes; the end card explains how a run ended (`Stage.tsx:89`) | partial |
| Harness features as removable, per-model assumptions | Components with assumptions and switches (`shared/components.ts:11`); model-change nudge on the Harness tab | implemented |

## Gaps
- Persist the builder's conversation (direct engine) or session id (SDK) after each phase so an interrupted run can resume at the phase boundary.
