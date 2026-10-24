---
title: Infrastructure noise in agentic coding evals
date: 2026-02-05
url: https://www.anthropic.com/engineering/infrastructure-noise
tags: evals, infra, reliability, coding-agents
takeaway: On Terminal-Bench 2.0, merely changing how much CPU and RAM sandboxes were allowed swung scores by 6 percentage points with model, harness and tasks held constant, more than many leaderboard gaps. Specify a guaranteed floor and a separate hard ceiling instead of one pinned value, record infrastructure configuration with every result, separate infra errors from agent failures, and distrust small score differences.
source: post
standing: bundled
foundations: effectiveConfig, reliability
---

## Learnings
- On Terminal-Bench 2.0 (TB2), with model, harness, and task set held constant, the gap between the least- and most-resourced infrastructure configuration was 6 percentage points (p < 0.01). Leaderboard gaps are often only a few points, so infrastructure configuration alone can exceed the margins leaderboards rely on.
- Naive binomial confidence intervals already span about 1-2 pp, and infrastructure confounders "stack on top of that, not within it." Across the moderate resource range the spread was just under 2 pp; at the extremes, 6 pp.
- Guidance: treat leaderboard differences under about 3 pp with skepticism until eval configuration is documented and matched. "A few-point lead might signal a real capability gap—or it might just be a bigger VM."
- How it was found: Anthropic ran TB2 on a Google Kubernetes Engine cluster, scores did not match the official leaderboard, and up to about 6% of tasks failed with infrastructure errors (mostly pod errors).
- Root cause: their Kubernetes config treated TB2's per-task CPU/RAM specs as both the guaranteed floor (request) and the hard ceiling (limit). Equal values leave zero headroom, so transient spikes trigger OOM kills. The official leaderboard's sandboxing provider (unnamed) enforces more leniently and allows temporary overallocation, favoring stability.
- Resource sweep across six configurations, strict 1x to uncapped (only 1x, 3x, uncapped reported): the infra error rate fell monotonically from 5.8% (1x) to 2.1% (3x) to 0.5% (uncapped), with the 1x to 3x drop at p < 0.001.
- Task success from 1x to 3x was within noise (p = 0.40), because most tasks that crashed at 1x would have failed anyway. From 3x to uncapped, infra errors fell another 1.6 pp but success rose almost 4 pp, and uncapped vs 1x was +6 pp (p < 0.01).
- Interpretation: up to about 3x, extra headroom mainly buys reliability (fewer spurious kills). Above about 3x it changes what is being measured, since tight limits reward lean strategies and generous limits reward resource-heavy ones.
- Tasks that improved with memory headroom included `rstan-to-pystan` and `compile-compcert`.
- In `bn-fit-modify` (Bayesian network fitting), some models first install pandas, networkx, scikit-learn and toolchains and the pod OOMs during installation under tight limits. A standard-library-only approach succeeds, and some models default to it, so different models have different default approaches and resource limits interact with model identity.
- Replication: the core effect replicated across several Anthropic models (unnamed) with consistent direction and varying magnitude. Non-Claude models were not rigorously tested, though similar trends are expected.
- On SWE-bench (227 problems, 10 samples each, RAM varied up to 5x baseline), scores rose monotonically with RAM but 5x was only +1.54 pp over 1x, because SWE-bench tasks are less resource-intensive.
- Other sources of variance: time limits matter in some configurations (no values given), plus cluster health, hardware specs, concurrency level and egress bandwidth. Anecdotally, pass rates fluctuated with time of day, likely because API latency varies with traffic and incidents; model providers can dedicate hardware to shield evals while external evaluators usually cannot.
- Recommendations for benchmark maintainers: publish recommended per-task CPU/RAM specs (TB2 does) and the enforcement methodology, and run public coding evals at multiple times of day and on multiple days.
- Recommendations for eval runners: ideally use identical hardware for scaffold and inference stack (often impractical), and specify two parameters per task, a guaranteed allocation (floor) and a separate hard kill threshold (ceiling), never a single pinned value. Calibrate the band so floor and ceiling scores fall within noise of each other, as the 3x ceiling example did, and report the multiplier used since it varies by benchmark.
- Treat resource configuration as a first-class controlled experimental variable, like prompt format or sampling temperature, and document it with every result.

## Harness implications
- Every eval or agent run must record its infrastructure configuration as metadata: CPU/RAM request vs limit, multiplier over task spec, time limit, concurrency, hardware, cluster, region, and wall-clock start time. Results without this provenance should be marked non-comparable.
- Distinguish infra errors (OOM kill, pod error, timeout, API error) from agent failures in the result schema, and show the infra error rate alongside the pass rate on every dashboard; a regression in pass rate with a rising infra error rate is an infra incident, not a model regression.
- Default sandboxes to a soft floor plus a separate hard ceiling (around 3x the task spec as a starting point) and expose the band as a tunable; warn when request equals limit.
- Regression detection must account for noise: compute confidence intervals, run multiple samples per task, and refuse to declare a regression on deltas smaller than the combined CI plus known infra variance (about 3 pp on TB2-like suites).
- Compare runs only when configuration metadata matches; the UI should diff configs between two runs before showing a score delta and highlight any mismatch.
- Schedule recurring evals at varied times of day and days and plot pass rate against time and observed API latency to catch time-dependent drift.
- Record per-trial resource usage (peak memory, CPU time, install steps) in the trace so reviewers can see when a task failed because the agent chose a heavy strategy versus a model error. Treat resource limits as part of the task definition that shapes agent strategy, so "lean vs heavy approach" becomes an observable behavior.
