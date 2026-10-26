---
title: Building AI-resistant technical evaluations
date: 2026-01-21
url: https://www.anthropic.com/engineering/AI-resistant-technical-evaluations
tags: evals, harness, long-running
takeaway: A take-home test built to rank engineers was saturated by successive Claude models, and the fix that worked was a novel, tightly constrained puzzle with a crisp objective score rather than a realistic task. For harness builders, the same lessons apply to agent benchmarks: results scale with compute and harness quality, models stall until given targets, and evals overlapping well-documented material saturate fast.
source: post
standing: bundled
foundations: effectiveConfig
---

## Learnings
- The original performance take-home was designed in two weeks in November 2023 to screen a surge of applicants before Claude 3 Opus, used since early 2024, completed by about 1,000 candidates in v1, and built most of the current performance team with dozens hired.
- Design goals: representative of real work; high signal (many chances to show skill, no single-insight problems, wide score spread, enough depth that strong candidates never finish); no domain knowledge required; and fun (fast dev loop, room for creativity).
- Format advantages over live interviews: a longer horizon (4 hours, later 2 because scheduling overhead delayed pipelines by weeks), a realistic setting (own editor, nobody watching), time to build tooling and comprehend the problem, and AI explicitly allowed.
- The artifact was a Python simulator of a TPU-like accelerator (manually managed scratchpad memory, VLIW packing, SIMD vectors, multicore) with a hot-reloading Perfetto trace of every instruction. The task was parallel tree traversal, and v1 included a planted bug candidates had to find first, which tests tooling skill.
- The strongest unlimited-time submissions built full optimizing mini-compilers and found optimizations the author had not anticipated. One Twitter-sourced candidate scored far above the field, started in Feb 2024, and found a workaround for a compiler bug (32-bit overflow in tensor indexing), so the test proved especially useful for thin resumes.
- Model erosion: Claude 3 Opus beat part 1 of a 2023 live question and Claude 3.5 Sonnet beat part 2. With Claude 3.7 Sonnet (by May 2025), more than 50% of candidates would have done better delegating entirely to Claude Code.
- Pre-release Claude Opus 4 with a 4-hour limit beat almost all humans. Version 2 used Opus 4's failure points as the new starting point, cleaner starter code, added machine features, removed multicore, and cut the limit to 2 hours, with emphasis on optimization insight over debugging. It lasted several months.
- Pre-release Opus 4.5 in Claude Code hit the passing threshold in under an hour, stalled believing a memory-bandwidth bottleneck was insurmountable, then found the trick when given a target cycle count. By 2 hours it matched the best human within the limit (who had heavily steered Claude 4). Under the time limit the author could no longer distinguish top human candidates from the strongest model.
- Banning AI was rejected because it is hard to enforce and the goal is to find how people stand out with AI, as on the job. Raising the bar to "substantially outperform Claude Code alone" was rejected because humans spend roughly half their time reading the problem, so the dominant strategy would be passively watching the model.
- Attempt 1, a different optimization problem (2D register transposition avoiding bank conflicts, distilled from a real kernel problem), failed: Claude implemented the simulator changes in under a day, Opus 4.5 found a better approach (transpose the computation, not the data), and after that was patched Claude Code with "ultrathink" solved the rest. Root cause: these topics are heavily written about, so training data covers them.
- Attempt 2, adopted: Zachtronics-style puzzles with a tiny, heavily constrained instruction set, score as minimal instruction count, and multiple independent sub-problems (possibly lower variance than v1). Opus 4.5 failed a medium-hard puzzle that colleagues less steeped in the problem still beat.
- The puzzle version ships no visualization or debugging tools and starter code only validates; building tooling (print statements, a quickly generated debugger) is part of the signal. Early scores correlate with past work quality. The trade-off is lost realism and varied depth, so resistance rests on novelty, not realism.
- Humans add judgment about tooling investment, debugging, systems design, performance analysis, verifying correctness, and simplifying Claude's code. Steering matters: the best 2-hour human heavily steered Claude 4.
- Cycle benchmarks (lower is better; released challenge uses the v2 instruction set, single core): 2164 for Opus 4 after many hours in harness; 1790 for Opus 4.5 in a casual Claude Code session (about the best human in 2h); 1579 for Opus 4.5 at 2h in harness; 1548 for Sonnet 4.5 well over 2h; 1487 for Opus 4.5 at 11.5h; 1363 for Opus 4.5 with an "improved harness" (a generic improvement, not described) after many hours.
- Anyone below 1487 cycles is invited to email performance-recruiting@anthropic.com with code and resume; the challenge is released at github.com/anthropics/original_performance_takehome.
- The iterative loop used: test a pre-release checkpoint in Claude Code, observe where it stalls, supply a target to unlock the trick, use the model's failure point as the next version's starting point, and validate in the harness at 2h and longer horizons.
- With unlimited time humans still beat the models: the model's advantage held only inside the 2-hour limit, so time-limited and open-ended results must be reported separately, and the longer horizon is where human judgment (tooling, verification, simplification) still adds the most.

## Harness implications
- [foundation:effectiveConfig] Record the harness version in every run, since harness quality alone moves results with the same model.
  > 1363 for Opus 4.5 with an "improved harness"
- [foundation:reliability] Benchmark the harness against fixed tasks across its own versions.
  > validate in the harness at 2h and longer horizons
- [foundation:reliability] Record time and token budget per run and compare results at matching budgets rather than as one number.
  > time-limited and open-ended results must be reported separately
- [foundation:cacheAsSignal] Let users inject a target, hint or constraint mid-run as a note, without editing the prompt, and log it.
  > then found the trick when given a target cycle count
- [gap] Separate "model alone" from "model plus human steering" when reporting results.
  > who had heavily steered Claude 4
- [gap] Let agents build and run their own debuggers and visualizers, and record when they do.
  > building tooling (print statements, a quickly generated debugger) is part of the signal
- [gap] Keep a regression suite of novel, private tasks and track their age and public exposure.
  > these topics are heavily written about, so training data covers them
- [stage:contract] Prefer a crisp objective measure with a validity check, such as a count or an exit code, over rubric scoring.
  > score as minimal instruction count
- [foundation:reviewIntent] Front-load problem comprehension for the human reviewer with summaries and state diffs so oversight keeps pace with the agent.
  > humans spend roughly half their time reading the problem
- [gap] Track debugging tasks and optimization tasks separately when measuring capability.
  > emphasis on optimization insight over debugging
