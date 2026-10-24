# How we contain Claude across products
Source: https://www.anthropic.com/engineering/how-we-contain-claude
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Default-deny egress with allowed domains as capability grants | Network off by default (`GuardrailPolicy.allowNetwork`), Seatbelt denies network (`sandbox.ts:43`); no per-domain grants | partial |
| Credentials out of the execution environment; scoped per-session tokens | `registry.ts:71` scrubbedEnv; SDK subprocess gets only the key it needs (`claudeCodeLoop.ts:184`) | implemented |
| Nothing from an untrusted directory executes before trust is granted | Workspace CLAUDE.md is read as text only; workspace skills are indexed (`skills.ts:45`) without a trust prompt; the SDK engine disables settings sources (`claudeCodeLoop.ts:212`) | partial |
| Resolve symlinks before path validation; filesystem modes | `policy.ts:89` confinePath is lexical only; `sandbox.ts:23` realpaths the workspace for the profile | partial |
| No persuadable privileged override; exceptions explicit and logged | Hard denies apply in every mode (`policy.ts:13`); user approvals are logged as `guardrail.decision` source=user | implemented |
| Inspect tool output before it enters context and show flags | `classifier.ts:48` sniffInjection (regex) wraps flagged output and notes it | partial |
| Prefer mature isolation primitives; audit custom pieces hardest | Seatbelt via `sandbox-exec` (`sandbox.ts`); SDK sandbox for the Claude Code engine | implemented |
| Observability of what left the sandbox over the network | Not implemented (no proxy) | gap |
| Treat persistent state as an injection surface; carry trust levels | Scout answers and tool output pass through sniffInjection; no provenance labels on CLAUDE.md or progress notes | partial |

## Gaps
- Realpath the resolved target in confinePath when it exists, so a symlink inside the workspace cannot point outside.
- Ask once per workspace before indexing `.reins/skills` and `.claude/skills` (approval kind `skill`).
- Run flagged tool output through a one-shot classifier call before deciding to wrap it.
