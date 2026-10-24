# Redesigning source control at Anthropic
Source: https://www.anthropic.com/engineering/redesigning-source-control
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Agents as always-online clients; optional sparse working copies | Local git checkout per workspace; no server-side source control | gap |
| Cheap commits scaling with the change | `git add -A && git commit` per phase (`orchestrator.ts:295`) | partial |
| Automated bisect and revert pipelines as tools | Not implemented | gap |
| Post-merge testing over a global merge queue | Out of scope for a single-workspace harness | gap |
| Intent-level review aids: semantic approval rules and summaries | Contract plus evaluator evidence as the review surface (`Contract.tsx`); commit messages name the phase; diffs on the Files tab | implemented |
| Checkable architectural constraints the agent must not violate | Hard denies and ask rules (`policy.ts:13-45`) are shell-level; no code-level constraints | partial |
| Per-directory permissions bounding blast radius | Workspace confinement (`policy.ts:89`); no finer scoping | partial |
| Content-addressed, immutable artifacts | Append-only JSONL log keyed by seq (`runStore.ts:28`); tool outputs stored by tool_use id (`loop.ts:504`) | partial |

## Gaps
- Add `constraints` (globs the builder may not touch, commands it may not run) to RunConfig, enforced in confinePath and classifyBash.
- A `git_bisect` deferred tool for fix rounds when a regression is detected.
