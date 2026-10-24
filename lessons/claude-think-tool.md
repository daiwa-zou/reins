---
title: The "think" tool: Enabling Claude to stop and think in complex tool use situations
date: 2025-03-20
url: https://www.anthropic.com/engineering/claude-think-tool
tags: tools, evals, reliability, harness
takeaway: A no-op think tool gives the model a scratchpad mid-chain to check rules and tool results before acting. It lifted consistency on policy-heavy tau-Bench airline tasks by 54% relative when paired with a domain-specific prompt in the system prompt, but extended thinking has since improved and is now recommended in most cases. Measure consistency with pass^k rather than single-shot success.
source: post
standing: bundled
components: thinkTool
foundations: reliability
---

## Learnings
- What it is: a tool that gives Claude a dedicated space to stop and check whether it has the information it needs before moving forward, during response generation. It adds no information and changes no state; it only logs a thought. It is useful in long tool-call chains and long multi-step conversations where the model must process external information (tool results) the query did not supply, and its reasoning is narrower than extended thinking and focuses on newly discovered information.
- Editorial update 2025-12-15: extended thinking has improved and is now recommended over a dedicated think tool in most cases.
- Extended thinking happens before the response is generated; the think tool happens after generation has started, mid-chain. Extended thinking is better for non-sequential tool calls, straightforward instruction following, and coding/math/physics without tools. The think tool is better for complex tools, careful analysis of tool outputs in long chains, policy-heavy environments, and sequential decisions where mistakes are costly.
- Spec (τ-Bench): name `think`; one required string parameter `thought` ("A thought to think about."); the description states it does not obtain new information or change the database, only appends the thought to the log, for complex reasoning or cache memory.
- τ-Bench evaluation: realistic customer-service scenarios with simulated users, policy following, and database manipulation via tools. The metric is pass^k, the probability all k independent trials succeed (consistency), as opposed to pass@k. The model was Claude 3.7 Sonnet, with configurations baseline, extended thinking alone, think tool alone, and think tool plus optimized prompt (airline only).
- Airline (hard, complex policy), pass^k for k=1..5: think plus prompt 0.584/0.444/0.384/0.356/0.340; extended thinking 0.412/0.290/0.232/0.192/0.160; think alone 0.404/0.254/0.186/0.140/0.100; baseline 0.332/0.206/0.148/0.116/0.100. The prose cites 0.570 vs 0.370 as a 54% relative improvement. Think plus prompt wins, and unprompted think is about equal to extended thinking.
- Retail (easier policy): think alone 0.812/0.735/0.685/0.650/0.626; baseline 0.783/0.695/0.643/0.607/0.583; extended thinking 0.770/0.681/0.623/0.581/0.548. The think tool alone was best with no extra prompting.
- Insights: prompting matters more on hard domains while easy domains benefit from the tool alone, and gains persist through k=5, implying better edge-case handling and consistency.
- The optimized airline prompt tells the model that, before acting after each tool result, it should use `think` as a scratchpad to list applicable rules, check that required information is collected, verify the planned action complies with policy, and check tool results for correctness.
- Prompt example 1 (cancel flight ABC123): verify user ID, reservation ID, reason; check the 24-hour booking rule; then ticket class and insurance; confirm no segments flown or in the past; collect missing info; get confirmation.
- Prompt example 2 (book 3 tickets to NYC, 2 checked bags each): get user ID; check membership tier (regular: 1 free bag each, 3 extra = $150; silver: 2; gold: 3) and payment methods on file (max 1 travel certificate, 1 credit card, 3 gift cards, all on profile, leftover certificate value forfeited); compute the total; get explicit booking confirmation.
- SWE-bench: adding the tool to the Claude 3.7 Sonnet setup that reached SOTA 0.623 had an isolated effect of +1.6% (n=30 with, n=144 without; Welch's t(38.89)=6.71, p<.001, d=1.47). The adapted description logs thoughts without changing the repository and suggests brainstorming fixes after locating a bug or after failing tests.
- Use it for tool output analysis before acting (possibly backtracking), policy-heavy environments, and sequential decision making where each action builds on prior ones.
- Best practices: strategic prompting with domain-specific examples covering reasoning depth, breaking instructions into steps, decision trees for common scenarios, and information-completeness checks. Put complex guidance in the system prompt, not the tool description, so it integrates with overall behavior.
- When not to use it: it costs longer prompts and more output tokens, and gives little gain for non-sequential, single or parallel tool calls or simple instruction following with good defaults.
- Getting started: test on hard agentic scenarios, add a domain-customized think definition plus system-prompt instructions and examples, and monitor usage and refine. The downside is minimal (no external effect unless called, no interference with other tools), and Claude 3.5 Sonnet (New) also gained, so the effect generalizes.

## Harness implications
- Offer a built-in no-op `think`/scratchpad tool the harness can enable per task profile (policy-heavy, long tool chains), while defaulting to native extended thinking for current models.
- Render think-tool content as collapsible reasoning rows distinct from tool calls so users can audit the checklist (rules, info gathered, compliance, result verification) without noise.
- Let task profiles inject domain checklists and examples into the system prompt (not tool descriptions), and make these editable templates.
- Measure consistency with pass^k-style repeated runs in the harness eval mode, not just single-shot success; surface variance.
- Encourage "verify tool results before acting" as a harness-level pattern: after large or surprising tool outputs, prompt the agent to assess them before the next side-effecting call.
- Track output-token cost of reasoning tools so users can see the trade-off and turn them off for simple flows.
- Use the SWE-bench adaptation as a template: after a failing test or located bug, the harness can nudge a brainstorming step before edits.
