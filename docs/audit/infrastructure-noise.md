# Infrastructure noise in agentic coding evals
Source: https://www.anthropic.com/engineering/infrastructure-noise
Lesson file checked against the original: yes (nothing missing)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Record infrastructure configuration with every run (CPU/RAM request vs limit, time limit, concurrency, hardware, start time) | Environment note records harness version, engine, node, platform/arch and git sha (`server/src/engine/orchestrator.ts:146-150`); `config.json` per run (`server/src/store/runStore.ts:17-20`); shell timeouts exist per command (`server/src/tools/registry.ts:86,253`). No CPU, RAM, concurrency or hardware facts | partial |
| Distinguish infra errors from agent failures in the result schema; show the infra error rate | Interrupted runs count as cancelled, not failed (`server/src/engine/trials.ts:19-21`); transient API errors retry with a note (`server/src/engine/loop.ts:350-355`); `error.recoverable` exists (`shared/types.ts:358`). A model-call failure, shell timeout or OOM still ends as `failed` like an agent failure, and `TrialSet` has no infra bucket (`shared/types.ts:470-485`) | partial |
| Default sandboxes to a soft floor plus a separate hard ceiling; warn when request equals limit | No resource limits at all: `runShell` enforces time only (`registry.ts:82-124`); Seatbelt is not a resource sandbox | gap |
| Regression detection must account for noise: confidence intervals, multiple samples, refuse small deltas | pass^k/pass@k projected from the observed rate (`shared/components.ts:381-385`); "Run 3 more" (`web/src/panels/Reliability.tsx:88-90`); the copy says three trials are a start (`Reliability.tsx:56`); no interval, no delta gating | partial |
| Compare runs only when configuration matches; diff configs before showing a score delta | `trialKey` is workspace plus task only (`shared/components.ts:376-378`); model, engine and harness version are recorded per trial (`trials.ts:22`) and listed per row (`Reliability.tsx:122-125`) but sets are not split or diffed by them | partial |
| Schedule recurring evals at varied times; plot pass rate against time and API latency | `createdAt` per trial (`Reliability.tsx:126`) and per-turn timestamps exist; no scheduler and no latency plot | gap |
| Record per-trial resource usage (peak memory, CPU time, install steps) in the trace | `tool.result.durationMs` per call (`loop.ts:404`); install commands surface as NETWORK ask decisions when network is off (`server/src/guardrails/policy.ts:66-71`); no memory or CPU | partial |
| Resource limits are part of the task definition and shape strategy (lean vs heavy becomes observable) | No limits, so no lean-vs-heavy signal | gap |
| Distrust leaderboard differences under about 3 pp until configurations are matched | Reliability copy warns that projected rates from three trials are not a verdict (`Reliability.tsx:56`); no numeric threshold | partial |
| Time limits influence scores in some configurations | `bash` default 120 s, max 600 s (`registry.ts:250-253`); timeouts appear as `[timed out after Ns]` in the output text (`registry.ts:255`) but not as a typed event; the SDK engine's timeouts are not controllable | partial |
| Up to 6% of tasks failed on infra errors: inspect why a run ended | EndCard always states how the run ended and a next step (`web/src/panels/Stage.tsx:139-158`); `run.status` carries the reason (`server/src/engine/runManager.ts:214-218`) | implemented |
| Treat resource configuration like prompt format or temperature: document it with every result | The request-shape note records model, effort, prompt hash, betas, context edits and tool count (`loop.ts:200-208`); the infra side is missing | partial |
| Pass rates fluctuate with API latency and incidents; retry transient errors | Retry after 5 s on rate-limit, 5xx and connection errors with a warn note (`loop.ts:350-355`); SDK `rate_limit`/`overloaded` surface as recoverable errors (`server/src/engine/claudeCodeLoop.ts:310`) | implemented |

## Gaps
- Environment note lacks infra facts: add `os.cpus().length`, `os.totalmem()`, the shell timeout, concurrency (always 1 today) and `process.resourceUsage()` at the end of the run, and copy them onto `Trial`.
- No infra bucket: add `Trial.failureKind: "agent" | "infra" | "none"` derived from the last `error` (API or connection error, shell timeout, interrupted) and show an infra error rate next to the pass rate.
- No resource limits: run `bash` under `ulimit -v`/`-t` (or `prlimit` on Linux) from `guardrail.limits {memMb, cpuSec}` with a separate soft warning threshold, and warn in `checkRunConfig` when soft equals hard.
- No interval: show a Wilson 95% interval next to the pass rate when n < 30 and grey out pass^k when the interval is wider than 0.3.
- No config match: split or badge trial sets when model, engine, harness version or effort differ, and add a "diff configs" link between two trials using `diffFromDefaults`.
- No time view: plot trial outcome against the hour of `createdAt` and mean turn latency (`turn.started` to `turn.finished`) in Reliability.
- No resource trace: record per-tool `durationMs` sums and the shell child's peak RSS (`/usr/bin/time -l`) on `tool.result`.
- Timeouts are untyped: set a `timedOut` field on `tool.result` (or a warn note) so they can be counted as infra.
