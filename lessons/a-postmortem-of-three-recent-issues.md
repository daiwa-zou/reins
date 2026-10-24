---
title: A postmortem of three recent issues
date: 2025-09-17
url: https://www.anthropic.com/engineering/a-postmortem-of-three-recent-issues
tags: postmortem, evals, infra, reliability
takeaway: Three overlapping infrastructure bugs degraded output quality for weeks because benchmarks, canaries and spot checks were too noisy to see them, and the model's habit of recovering from isolated mistakes masked the damage. A harness needs continuous production quality checks, signals segmented by platform and routing target, and enough trace metadata to join user reports to the exact deployment that caused them.
---

## Learnings
- Between early August and early September 2025, three infrastructure bugs intermittently degraded Claude's output quality. Anthropic states it never reduces quality due to demand, time of day, or server load.
- Claude is served via the first-party API, Amazon Bedrock, and Google Cloud Vertex AI, on AWS Trainium, NVIDIA GPUs, and Google TPUs. Each platform needs its own optimizations; Anthropic holds strict equivalence standards, and any infrastructure change must be validated across all platforms and configurations.
- Bug 1, context-window routing: on Aug 5 some Sonnet 4 requests were misrouted to servers configured for the upcoming 1M-token context window, initially about 0.8% of Sonnet 4 requests.
- On Aug 29 a routine load-balancing change increased misrouting of short-context requests; the worst hour (Aug 31) affected 16% of Sonnet 4 requests.
- Routing was "sticky": once a request hit the wrong server, follow-ups likely went there too, so some users were far more affected than others. About 30% of Claude Code users who made requests in the window had at least one misrouted message.
- Platform impact of the routing bug: Bedrock peaked at 0.18% of Sonnet 4 requests (from Aug 12); Vertex AI saw under 0.0004% (Aug 27 - Sep 16). The fix was deployed Sep 4, with rollout completed Sep 16 (first-party, Vertex) and Sep 18 (Bedrock).
- Bug 2, output corruption: on Aug 25 a misconfiguration deployed to Claude API TPU servers, combined with a runtime performance optimization, occasionally assigned high probability to tokens that should rarely appear, such as Thai or Chinese characters in English answers and syntax errors in code.
- It affected Opus 4.1 and Opus 4 (Aug 25-28) and Sonnet 4 (Aug 25 - Sep 2); third-party platforms were unaffected. It was rolled back Sep 2, and detection tests for unexpected character outputs were added to the deployment process.
- Bug 3, approximate top-k XLA:TPU miscompilation: on Aug 25 a change to token-selection code triggered a latent bug in the XLA:TPU compiler. It was confirmed on Haiku 3.5 and likely hit a subset of Sonnet 4 and Opus 3 on the Claude API. Rollbacks: Haiku 3.5 Sep 4, Opus 3 Sep 12, and Sonnet 4 as a precaution even though the bug could not be reproduced there.
- Technical chain: next-token sampling uses top-p (typically 0.99 or 0.999), and on TPUs the model spans tens of chips, requiring a distributed sort. In Dec 2024 the TPU implementation sometimes dropped the most probable token at temperature 0, and a workaround was deployed.
- Root cause involved mixed precision: probabilities in bf16, but the vector unit is fp32-native and XLA may promote ops under `xla_allow_excess_precision` (default true), so different ops disagreed on the top token. A minimized reproducer merged Aug 11, and an Aug 26 sampling rewrite fixed precision and top-p threshold handling and removed the December workaround.
- That workaround had been masking a deeper bug in approximate top-k (`approx_max_k`), a speed optimization that should only err on the lowest-probability tokens but instead dropped the highest-probability token for certain batch sizes and model configurations.
- It was hard to reproduce: behavior changed with unrelated operations before or after it, enabling debugging tools changed the outcome, the same prompt passed one request and failed the next, and the reproducer returned correct results on CPUs.
- Permanent fix: exact top-k (no longer prohibitively expensive) plus standardizing additional ops on fp32, accepting a minor efficiency cost, while working with the XLA:TPU team on a compiler fix. Exact top-k may slightly change which tokens near the top-p threshold are included, so some users may need to re-tune top-p.
- Why detection failed: benchmarks, safety evals, performance metrics, spot checks and canary deployments did not capture the degradation. Claude often recovers from isolated mistakes, which masked the problem, and the team "relied too heavily on noisy evaluations."
- Privacy and security controls limit engineers' access to user interactions not submitted as feedback, which protects users but slowed investigation of the exact failures.
- Each bug produced different symptoms on different platforms at different rates, so reports looked random. Reports spiked Aug 29 but were not immediately linked to the load-balancing change, because there was no clear way to tie online reports to specific recent changes.
- Planned changes: more sensitive evaluations that distinguish working from broken implementations, continuous quality evaluations on real production systems, privacy-preserving debugging infrastructure and bespoke tooling to shorten remediation, and feedback channels (`/bug` in Claude Code, thumbs-down in Claude apps, feedback@anthropic.com).

## Harness implications
- Continuous production quality monitoring, not just pre-release evals: sample live traffic through cheap canary checks (unexpected-character detectors, syntax validity of code outputs, language-mismatch detectors) and alert on deviation.
- Segment every quality signal by serving platform, hardware, model version, context-window class, and routing target; aggregate metrics hid a 16%-of-requests problem because it was confined to one slice and one hour.
- Record routing and serving metadata (which server pool, which configuration, which compiler or runtime flags) in each request trace so a report can be joined to the exact deployment that produced it.
- Correlate user-report volume with the deployment timeline automatically: a spike in negative feedback within hours of a change should surface that change as a suspect.
- Sticky failures mean per-user impact is far worse than per-request rates; show both request-level and user-level affected fractions.
- Make evals sensitive enough to see single-token errors; because the model recovers from isolated mistakes, outcome-only graders miss corruption. Add transcript-level checks (token-level anomalies, non-target-language characters, syntax errors) alongside outcome checks.
- Removing a workaround is a risky change: track known workarounds with the bug they mask and require a reproducer that fails without them before removal.
- Build privacy-preserving debug tooling in advance: opt-in session capture, redacted trace export with `/bug`, and a way to attach the config and trace to a report.
- Any infra change must be validated across every platform and configuration before rollout; a cross-platform equivalence suite belongs in CI.
