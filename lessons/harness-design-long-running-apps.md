---
title: Harness design for long-running application development
date: 2026-03-24
url: https://www.anthropic.com/engineering/harness-design-long-running-apps
tags: harness, long-running, multi-agent, evals, coding-agents
takeaway: Long application builds improved sharply when a planner, generator and separate skeptical evaluator exchanged files and negotiated sprint contracts, because agents overrate their own work and an independent evaluator is easier to make critical. But every harness component encodes an assumption about what the model cannot do alone, and those assumptions go stale, so remove components one at a time as new models ship.
---

## Learnings
- Models lose coherence as context fills, and show "context anxiety": wrapping up early when they approach a perceived limit.
- Compaction gives continuity but no clean slate. A context reset (a fresh agent plus a structured handoff) fixes the anxiety but adds orchestration, token and latency overhead.
- Agents overrate their own output, especially on subjective work. A standalone evaluator is easier to make skeptical than a generator is to make self-critical.
- A GAN-style generator/evaluator loop for frontend work used 4 criteria (design quality, originality, craft, functionality), weighted toward design and originality. Originality penalized stock components and AI-telltale patterns, and the evaluator was calibrated with few-shot examples plus score breakdowns to reduce drift.
- The frontend evaluator used Playwright to look at the live page, and runs took 5-15 iterations and up to 4 hours. After each evaluation the generator chooses to refine or pivot, criteria wording steers style (e.g. "museum quality"), and scores are non-linear, with middle iterations sometimes best.
- The full-stack harness (Opus 4.5) has three agents. The planner turns a 1-4 sentence prompt into a product spec kept high-level on tech so early errors do not cascade. The generator works in sprints, one feature at a time, self-evaluates and uses git. The evaluator does a Playwright click-through plus API and DB state checks with hard thresholds per criterion, where any failure fails the sprint.
- Sprint contracts: before coding, the generator proposes what "done" means and how to verify it, the evaluator reviews, and they iterate until agreed. Agents exchange files, not shared context.
- Results: the solo run took 20 minutes and $9 with the core feature broken, while the harness took 6 hours and $200 and produced a working app with 16 features over 10 sprints. Sprint 3 alone had 27 contract criteria.
- Evaluator findings were specific (drag-fill only at endpoints, a narrow delete condition, route ordering causing a 422).
- Out-of-the-box Claude is a weak QA agent: it finds real issues, then talks itself into approving them, and tests superficially. The fix is to read the evaluator's logs and revise the QA prompt wherever its judgment diverges from yours.
- V2 (Opus 4.6): each harness component encodes an assumption about what the model cannot do alone, and those assumptions go stale. Remove one component at a time, because removing all at once obscures which were load-bearing.
- In V2 the sprint construct was removed, the planner was kept (without it the generator under-scopes), the evaluator became a single pass at the end, and context resets were dropped in favor of one continuous session with compaction.
- A browser-based DAW test took about 4 hours and $124.70: planner 4.7 min for $0.46; build rounds of 2h07 for $71, 1h02 for $37 and 11 min for $6; and QA rounds of about 7-10 min and roughly $3-4 each. QA still caught gaps.
- Limitation: the model cannot hear audio, so QA is weak on musical taste.
- Recommendations: experiment with the target model, read traces on realistic problems and tune against them; decompose tasks and assign specialized agents. Re-examine the harness when a new model ships, removing non-load-bearing pieces and adding pieces that enable new capabilities. The design space shifts, it does not shrink.

## Harness implications
- Use a separate evaluator role, skeptical by prompt, with access to the live artifact (browser, screenshots) and hard per-criterion thresholds.
- Negotiate contracts before work ("definition of done" plus a verification plan); the UI should surface these and let the user edit and approve them.
- Use file-based handoff between agents (progress files, specs, contracts).
- Track cost and time per phase and show them per phase (planner, build, QA).
- Harness components should be toggleable individually ("ablation" switches) so users can remove stale scaffolding per model.
- Make the context strategy, compaction vs reset, a visible and configurable choice.
