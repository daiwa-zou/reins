---
title: An update on recent Claude Code quality reports
date: 2026-04-23
url: https://www.anthropic.com/engineering/april-23-postmortem
tags: postmortem, coding-agents, evals, context, reliability
takeaway: Three separate harness changes, a lowered default reasoning effort, a caching optimization that silently dropped prior reasoning, and a terse-output system prompt, combined to look like a broad quality decline that evals, tests and dogfooding all missed. Treat defaults, context pruning and prompt text as code: log every context operation, test the exact shipped build, run per-model evals and ablations, and roll out gradually.
source: postmortem
standing: bundled
components: contextEditing
foundations: effectiveConfig, cacheAsSignal
---

## Learnings
- Reports of degraded responses were traced to three separate changes in Claude Code (also affecting the Claude Agent SDK and Claude Cowork). The API itself was unaffected, and all three were resolved as of April 20 in v2.1.116. Anthropic states it never intentionally degrades models.
- Each change hit a different traffic slice on a different schedule, so the combined effect looked like inconsistent, widespread decline. Reports began in early March but were hard to separate from normal feedback variation, and internal usage and evals did not reproduce them.
- Issue 1, default reasoning effort (Mar 4 - Apr 7): Opus 4.6 shipped in Feb 2026 with default effort `high`, and feedback said high-effort thinking sometimes ran so long the UI appeared frozen, with high latency and token use.
- On Mar 4 the default changed to `medium` (sent as the `effort` parameter on the Messages API; other levels via `/effort`). Internal evals showed slightly lower intelligence, significantly lower latency for most tasks, no long-tail thinking latency, and better usage-limit headroom, and an in-product dialog explained the change.
- Users reported Claude Code felt less intelligent, and design iterations (startup notices, inline effort selector, return of `ultrathink`) did not move most users off `medium`. It was reverted Apr 7: defaults are now `xhigh` for Opus 4.7 and `high` for all other models. Sonnet 4.6 and Opus 4.6 were affected.
- Lesson on issue 1: users prefer maximum intelligence by default with the option to lower effort; a defaults change is a product regression even when evals say the tradeoff is small.
- Issue 2, caching optimization that dropped prior reasoning (Mar 26 - Apr 10): after a session idled more than 1 hour, old thinking blocks were meant to be cleared once using the `clear_thinking_20251015` header with `keep:1`, since the resumed request is a cache miss anyway and pruning reduces uncached tokens. Full reasoning history was then supposed to resume.
- Actually, once a session crossed the idle threshold, every subsequent request in that process applied the prune. A follow-up sent mid-tool-use started a new turn under the faulty flag, so even the current turn's reasoning was dropped and Claude kept executing with less of its own rationale.
- Symptoms were forgetfulness, repetition, and odd tool choices. Dropping thinking blocks changed the request prefix each turn, causing cache misses, which Anthropic believes drove usage limits draining faster than expected.
- Why detection failed: the change passed human and automated code review, unit tests, end-to-end tests, automated verification, and dogfooding. Only stale or resumed sessions were affected, an internal-only server-side message-queuing experiment and a separate change to how thinking is displayed masked the bug in most CLI sessions, and root cause took more than a week to confirm.
- Back-test: Code Review was run on the offending PRs with full repository context; Opus 4.7 found the bug and Opus 4.6 did not. Follow-up: add support for additional repositories as Code Review context. The fix shipped Apr 10 in v2.1.101, and Sonnet 4.6 and Opus 4.6 were affected.
- Issue 3, system prompt verbosity constraint (Apr 16 - Apr 20): Opus 4.7 is verbose at launch, and the levers used were training, prompting, and thinking UX. Shipped prompt lines were "keep text between tool calls to ≤25 words" and "Keep final responses to ≤100 words unless the task requires more detail."
- Several weeks of internal testing and evals showed no regressions on the eval set run at the time, but combined with other prompt changes the lines hurt coding quality. Later line-by-line ablations (remove each prompt line, measure) on a broader eval set found one eval with a 3% drop for both Opus 4.6 and 4.7, and it was reverted Apr 20. Sonnet 4.6, Opus 4.6 and Opus 4.7 were affected.
- Lesson on issue 3: prompt text aimed at one model's quirk was applied to all models, and eval sets must be broad and per-model before a prompt change ships.
- Remediations: a larger share of internal staff will use the exact public build of Claude Code (internal testing used a build with unreleased features); improve internal Code Review and ship it to customers with multi-repo context; every system prompt change goes through a broad per-model eval suite with continued ablations and better review tooling.
- Further remediations: CLAUDE.md guidance that model-specific changes must be gated to their target model; soak periods, broader evals and gradual rollouts for changes that could trade off against intelligence; usage limits reset for all subscribers Apr 23; a new comms channel (@ClaudeDevs on X plus centralized GitHub threads); credit to users who filed `/feedback` with reproducible examples.
- Timeline: Feb Opus 4.6 ships (`high`); early Mar reports begin; Mar 4 effort to `medium`; Mar 26 caching change ships; Apr 7 effort reverted; Apr 10 caching fix (v2.1.101); Apr 16 verbosity prompt ships with Opus 4.7; Apr 20 prompt reverted and all resolved (v2.1.116); Apr 23 limits reset and postmortem published.

## Harness implications
- [foundation:eventLog] Log every prune, clear or compaction of thinking or messages per turn with its trigger, so the trace shows what was removed.
  > every subsequent request in that process applied the prune
- [gap] Alert when thinking is cleared on several consecutive turns or in the middle of tool use.
  > so even the current turn's reasoning was dropped
- [foundation:cacheAsSignal] Track cache hit rate and uncached tokens per session, because a jump in cache misses after a release is a regression signal on its own.
  > Dropping thinking blocks changed the request prefix each turn, causing cache misses
- [gap] Cover session-state corner cases (idle over an hour, resume, follow-up during tool use) with explicit regression tests and fixtures.
  > Only stale or resumed sessions were affected
- [gap] Test the exact artifact users run, not an internal build with unreleased features.
  > the exact public build of Claude Code
- [foundation:effectiveConfig] Record every flag or experiment active during a run in its metadata so a masking change can be found.
  > an internal-only server-side message-queuing experiment and a separate change to how thinking is displayed masked the bug
- [foundation:effectiveConfig] Treat prompt changes as code: version them and ablate them line by line before they ship.
  > Later line-by-line ablations (remove each prompt line, measure)
- [gap] Gate model-specific prompt lines to their target model in the harness, not by convention.
  > model-specific changes must be gated to their target model
- [foundation:effectiveConfig] Show the effective effort, model and prompt version of a run, since a defaults change is a regression until proven otherwise.
  > a defaults change is a product regression even when evals say the tradeoff is small
- [foundation:reliability] Use soak periods and quality signals segmented by release, model and effort so a small slice-level drop does not hide in aggregate.
  > soak periods, broader evals and gradual rollouts
- [gap] Run automated code review with full repository context over every change to the harness.
  > Opus 4.7 found the bug and Opus 4.6 did not
- [foundation:eventLog] Pair each user feedback report with the session's config and trace so it can be reproduced.
  > credit to users who filed `/feedback` with reproducible examples
