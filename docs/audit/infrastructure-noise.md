# Infrastructure noise in agentic coding evals
Source: https://www.anthropic.com/engineering/infrastructure-noise
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Record infrastructure configuration as metadata on every run | Environment note: harness version, engine, node, platform, git sha (`orchestrator.ts:148`); no CPU/RAM limits (none are imposed) | partial |
| Distinguish infra errors from agent failures and show both rates | Interrupted runs are excluded from trial rates (`trials.ts:21`); tool timeouts are marked in results (`registry.ts:246`); no infra-error rate on the dashboard | partial |
| Soft floor plus hard ceiling on resources | Not applicable locally; shell timeout only (`registry.ts` runShell) | gap |
| Noise-aware regression detection with confidence intervals | Reliability tab refuses to project rates with fewer than k trials (`Reliability.tsx`); no confidence intervals | partial |
| Diff configs before comparing scores | Each trial row shows model, engine and harness version (`Reliability.tsx`); no config diff | partial |
| Vary scheduling time; plot pass rate against time and latency | Not implemented | gap |
| Per-trial resource usage in the trace | Duration per tool call and per phase (`tool.result.durationMs`, `phase.finished.durationMs`); no memory or CPU | partial |

## Gaps
- Record per-run `process.resourceUsage()` deltas and the shell timeout in the Environment note.
- Show a Wilson interval next to the pass rate when n is small, and a config diff when two trials in a set differ in model, engine or version.
