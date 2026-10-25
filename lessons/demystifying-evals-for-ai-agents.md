---
title: Demystifying evals for AI agents
date: 2026-01-09
url: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
tags: evals, harness, reliability, coding-agents
takeaway: Build agent evals early from real failures, grade the outcome rather than the path, and treat the transcript as the primary debugging surface. Separate capability evals from near-100% regression suites, report both pass@k and pass^k, isolate every trial, and treat a task nobody passes as a probably-broken task. Layer automated evals with production monitoring, A/B tests, feedback and manual transcript review.
source: post
standing: bundled
---

## Learnings
- Vocabulary worth adopting verbatim: an eval is input plus grading logic on output; a task is one test with inputs and success criteria; a trial is one attempt (run several because outputs vary); a grader scores one aspect; a transcript (trace/trajectory) is the full record of a trial, for the Anthropic API the complete `messages` array; an outcome is the final environment state (the reservation row exists in SQL, not "Your flight has been booked").
- More vocabulary: the evaluation harness is the infra that runs evals end to end (instructions, tools, concurrency, recording, grading, aggregation); the agent harness or scaffold is what lets a model act as an agent, so "evaluating an agent" means evaluating harness plus model together; a suite is tasks grouped by a shared goal. Agent evals are harder than single-turn because of many tool calls, state mutation, and mistakes that "can propagate and compound."
- Without evals teams are "flying blind": they react to "feels worse after changes" reports and cannot separate real regressions from noise. Evals force concrete product requirements, speed model upgrades (days instead of weeks), and give baselines for free on a static task bank (latency, token usage, cost per task, error rates), making them "the highest-bandwidth communication channel between product and research teams."
- Costs are up-front and visible while benefits accumulate. Claude Code added evals for concision, file edits, then over-engineering; Descript grades three dimensions (don't break things, do what I asked, do it well); Bolt built its eval system in 3 months.
- Code-based graders (string match, fail-to-pass and pass-to-pass tests, static analysis, outcome verification, tool-call verification, transcript analysis) are fast, cheap, objective, reproducible and debuggable, but brittle to valid variation and lacking nuance.
- Model-based graders (rubric scoring, natural-language assertions, pairwise comparison, reference-based, multi-judge consensus) are flexible and scalable and handle open-ended output, but are non-deterministic, costlier, and need calibration against humans. Human graders (SME review, crowdsourcing, spot checks, A/B tests, inter-annotator agreement) are the gold standard used to calibrate model graders, but expensive and slow.
- Scoring per task can be weighted (combined score over threshold), binary (all graders pass), or hybrid.
- Capability evals start with low pass rates (a hill to climb), while regression evals should sit near 100% and any drop means something broke. A capability eval that reaches a high pass rate "graduates" into the regression suite run continuously to catch drift: "Can we do this at all?" becomes "Can we still do this reliably?"
- pass@k is the probability of at least one success in k attempts and rises with k (use when one success suffices; coding usually reports pass@1). pass^k is the probability that all k trials succeed and falls with k (use when consistency matters, e.g. customer-facing agents): 75% per trial over 3 trials is 0.75^3, about 42%. At k=1 both equal the per-trial rate; by k=10 pass@k approaches 100% while pass^k falls toward 0%.
- Coding agents are mostly graded deterministically (tests run and pass), plus static analysis (ruff, mypy, bandit), state checks (a security log event `auth_blocked`), tool-call checks (read_file, edit_file, run_tests), and an LLM rubric for code quality. Tracked metrics: n_turns, n_toolcalls, n_total_tokens, time_to_first_token, output_tokens_per_sec, time_to_last_token. SWE-bench Verified went from about 40% to over 80% in a year; Terminal-Bench covers tasks like building a Linux kernel.
- Conversational agents need multidimensional grading: a state check (ticket resolved), a transcript constraint (≤10 turns), an LLM rubric (tone, grounded in `fetch_policy` output), and tool-call checks (`process_refund` amount ≤100). They also need a second LLM to simulate the user (τ-Bench, τ2-Bench).
- Research agents are graded on groundedness (claims supported by retrieved sources), coverage (required facts), and source quality, with exact match for objective facts; rubrics need frequent expert calibration and ground truth drifts (BrowseComp). Computer-use agents are verified on URL or page state plus backend state (order actually placed), file system, app config, DB, and UI element properties (WebArena, OSWorld); DOM is fast but token-heavy while screenshots are slower but token-cheap.
- Roadmap steps 0-1: start with 20-50 tasks from real failures (early changes have large effects so small n suffices; waiting means reverse-engineering success criteria from a live system), converting manual pre-release checks, bug tracker and support queue items into tasks prioritized by user impact.
- Roadmap step 2: two experts should independently reach the same verdict and every task must be passable. A 0% pass rate over many trials (pass@100 = 0) "is most often a signal of a broken task, not an incapable agent," so ship a reference solution that passes all graders to prove solvability and validate grader wiring (a broken-task example: tests assume a file path the spec never states).
- Roadmap steps 3-4: use balanced sets with cases where behavior should and should not trigger (web search over/under-triggering took many rounds; one-sided evals create one-sided optimization), and run a stable harness with a clean environment per trial. Leftover files, cached data, or resource exhaustion cause correlated infra failures, and Claude once read git history from previous trials to gain an advantage.
- Roadmap step 5, graders: use deterministic graders when possible, LLM where needed, humans sparingly; grade "what the agent produced, not the path it took," give partial credit, calibrate judges to experts with an "Unknown" escape hatch, use one isolated judge per rubric dimension, and make graders hack-resistant.
- Grader bugs matter: Opus 4.5 scored 42% on CORE-Bench until rigid grading ("96.12" vs "96.124991…"), ambiguous specs, and non-reproducible stochastic tasks were fixed and the scaffold loosened, after which it scored 95%. METR found tasks requiring exceeding a stated threshold, penalizing instruction-following.
- Roadmap step 6: "Read the transcripts!" Anthropic built transcript-viewing tooling and reads regularly; for each failure decide whether it is a genuine mistake or the grader rejected a valid solution. "Failures should seem fair."
- Roadmap steps 7-8: a 100% eval tracks regressions but gives no improvement signal (SWE-bench Verified went about 30% to over 80% in a year; Qodo's one-shot evals missed Opus 4.5 gains on long tasks until they built an agentic eval framework). Keep a living suite with clear ownership: an evals team owns infra, domain experts and product teams contribute tasks via PRs with Claude Code, and eval-driven development writes evals for planned capabilities before the agent can pass them.
- Holistic "Swiss cheese" evaluation: automated evals (CI, every commit; false confidence if unrepresentative), production monitoring (ground truth but reactive and noisy), A/B tests (real outcomes, slow, no "why" without transcripts), user feedback (sparse, self-selected, skewed severe), manual transcript review (builds intuition; fatigue, inconsistent coverage), and systematic human studies (calibration). Cadence: triage feedback constantly and sample transcripts weekly.
- Frameworks named: Harbor (hosts Terminal-Bench 2.0), Braintrust/autoevals, LangSmith, Langfuse, Arize Phoenix/AX; task quality matters more than framework.
- A grader can punish a better answer: Opus 4.5 on τ2-bench found a policy loophole and "failed" the eval as written while producing a better outcome for the user, so a verdict of fail must be read against the transcript before it is trusted, and graders should be revisited when the agent beats the spec.

## Harness implications
- [foundation:reliability] Report pass@k and pass^k over k trials so a flaky task is visible rather than averaged away.
  > pass@k is the probability of at least one success in k attempts and rises with k
- [foundation:eventLog] Keep every trial's full transcript as the record that graders and reviewers read.
  > Anthropic built transcript-viewing tooling and reads regularly
- [component:evaluator] Grade with deterministic checks where possible and a model judge only where needed.
  > use deterministic graders when possible, LLM where needed, humans sparingly
- [component:narration] Make the transcript easy to read, because reading transcripts is how failures get diagnosed.
  > "Read the transcripts!"
- [stage:evaluate] Grade what was produced, not the path taken, and give per-criterion credit.
  > grade "what the agent produced, not the path it took," give partial credit
- [stage:evaluate] For each failure, decide whether the work is wrong or the check rejected a valid result, and say which.
  > for each failure decide whether it is a genuine mistake or the grader rejected a valid solution
- [stage:contract] Write criteria two reviewers would independently judge the same way, and make sure each one is passable.
  > two experts should independently reach the same verdict and every task must be passable
- [stage:contract] Include cases where the behaviour should not trigger as well as cases where it should.
  > use balanced sets with cases where behavior should and should not trigger
- [gap] Separate capability and regression suites, and graduate a capability task into regression once it passes reliably.
  > A capability eval that reaches a high pass rate "graduates" into the regression suite
- [gap] Flag a task at 0% across all trials as probably broken rather than hard.
  > "is most often a signal of a broken task, not an incapable agent,"
- [gap] Calibrate model judges against human labels.
  > calibrate judges to experts
