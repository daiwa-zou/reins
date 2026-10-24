# Confidential Inference via Trusted Virtual Machines
Source: https://www.anthropic.com/engineering/confidential-inference-trusted-vms
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Small trusted core; tools, plugins and UI treated as untrusted | Guardrails and credential handling are concentrated in `server/src/guardrails/` and `registry.ts:71`; tools are plain functions behind the gate (`loop.ts` gate) | partial |
| Secrets decrypted only where used; tools receive handles, never raw secrets | API key held by the server (`runManager.ts` client); stripped from tool environments (`registry.ts:71`); stored owner-only in `~/.reins/settings.json` (`index.ts`) | implemented |
| Record hash and version of every prompt and harness component in each trace | Harness version in the Environment note (`orchestrator.ts:148`); prompt hash, betas and edits in the request-shape note (`loop.ts:202`) | implemented |
| Concentrate trust decisions in one auditable place and log every decision | All gating in `loop.ts` gate / `claudeCodeLoop.ts:109` canUseTool, each emitting `guardrail.decision`; Guardrails tab lists them | implemented |
| Disable escape hatches in production mode and make the mode visible | Trust mode exists (`policy.ts:48`) and is shown on the Guardrails tab; no separate production mode | partial |
| Hypervisor- or container-isolated execution with egress limits | Seatbelt sandbox (`sandbox.ts`), no container or bandwidth limits | partial |
| Classifier-gated high-risk actions with the verdict in the trace | `classifier.ts:17` classifyAction and `claudeCodeLoop.ts:363` classifyViaClaudeCode; verdicts logged as `guardrail.decision` source=classifier | implemented |
| Exportable tamper-evident audit logs | Append-only JSONL per run (`server/src/store/runStore.ts:28`); no signing or export endpoint | partial |

## Gaps
- Add `GET /api/runs/:id/export` producing the JSONL with a SHA-256 chain per line so a reviewer can verify it was not edited.
- A 'production' guardrail mode that disables trust mode and allow patterns and shows a badge in the TopBar.
