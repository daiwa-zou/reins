---
title: How we built our multi-agent research system
date: 2025-06-13
url: https://www.anthropic.com/engineering/multi-agent-research-system
tags: multi-agent, evals, reliability, context
takeaway: An orchestrator-worker research system with parallel subagents beat a single agent by 90.2% on internal evals, mainly because it spends more tokens in separate context windows, at roughly 15x chat cost. The lesson is that delegation quality, effort scaling, tool design and production tracing decide success, and that multi-agent suits high-value, parallelizable work, not tightly coupled tasks like most coding.
source: post
standing: bundled
components: scouts, resetWithHandoff, taskBudget, narration
foundations: fileHandoff
---

## Learnings
- Research is open-ended and the path cannot be fixed in advance, so agents that pivot across many autonomous turns beat linear pipelines and static RAG (which retrieves similar chunks once).
- Multi-agent is compression: each subagent has its own context window, tools, prompt and trajectory, searches in parallel, and condenses the important findings for the lead. Separate trajectories reduce path dependency.
- Internal eval: a Claude Opus 4 lead with Claude Sonnet 4 subagents beat single-agent Opus 4 by 90.2%. An example win was listing board members of all IT-sector S&P 500 companies, where the single agent failed with slow sequential searches.
- BrowseComp analysis: three factors explain 95% of performance variance, with token usage alone explaining 80% and tool-call count and model choice the rest. Upgrading Sonnet 3.7 to Sonnet 4 gained more than doubling the Sonnet 3.7 token budget.
- Cost: agents use about 4x chat tokens and multi-agent about 15x, so it is only economical for high-value tasks. It is a poor fit for tasks that need shared context or have many inter-agent dependencies, "such as most coding tasks", and a good fit for heavy parallelization, information exceeding one context window, and many complex tools.
- Architecture (orchestrator-worker): the LeadResearcher analyzes the query, plans, saves the plan to Memory (context past 200k tokens is truncated), spawns subagents with specific tasks, synthesizes results, then decides to research further, spawn more, or refine strategy.
- Subagents run searches and tool calls independently, use interleaved thinking to evaluate each result, and return findings. A CitationAgent post-processes the documents and draft report to attach citations so every claim is attributed, and the loop exits when the lead judges information sufficient.
- Principle 1, think like your agents: simulate in the Console with the exact prompts and tools and step through. This exposed failures such as continuing after sufficient results, verbose queries, and wrong tool choice.
- Principle 2, teach delegation: each subagent brief needs an objective, output format, tool and source guidance, and task boundaries. Vague briefs caused duplicate work (two subagents both did 2025 supply-chain research while one did the 2021 chip crisis).
- Principle 3, scale effort to complexity: simple fact-finding uses 1 agent and 3-10 tool calls; a direct comparison uses 2-4 subagents with 10-15 calls each; complex research uses 10+ subagents with divided responsibilities. Early failures included spawning 50 subagents for simple queries, endless searching for nonexistent sources, and excessive status updates distracting other agents.
- Principle 4, tool design is critical: examine all tools first, match tool to intent, prefer specialized over generic, and use web search for broad exploration. Bad descriptions send agents down wrong paths, and searching the web for context that lives only in Slack is "doomed from the start".
- Principle 5, let agents improve themselves: Claude 4 diagnosed prompt failures and proposed fixes, and a tool-testing agent ran a flawed MCP tool dozens of times and rewrote its description, cutting later task completion time by 40%.
- Principle 6, start wide then narrow: short broad queries first, assess the landscape, then narrow (the default behaviour was long specific queries with few results). Principle 7, guide the thinking: extended thinking is a controllable scratchpad the lead uses to pick tools, gauge complexity and set subagent count and roles, while subagents plan then use interleaved thinking after each tool result to assess quality, find gaps and refine.
- Principle 8, parallelize: the lead spawns 3-5 subagents in parallel and subagents issue 3+ tool calls in parallel, cutting research time by up to 90% on complex queries. Prefer heuristics over rigid rules (decompose, judge source quality, adapt, depth vs breadth) and add explicit guardrails against spiralling.
- Evaluation: agents take different valid paths, so judge outcomes plus whether the process was reasonable, not step sequences. About 20 representative real queries suffice early, when a prompt change can move success from 30% to 80%.
- LLM-as-judge uses a single call and single prompt outputting a 0.0-1.0 score and pass/fail, with a rubric of factual accuracy, citation accuracy, completeness, source quality (primary over secondary) and tool efficiency. One judge was more consistent and human-aligned than multiple judges.
- Human testing caught what automation missed: early agents preferred SEO content farms over authoritative PDFs and personal blogs, fixed with source-quality heuristics. Emergent behaviour matters too: small lead-prompt changes unpredictably shift subagent behaviour, so understand interaction patterns, not agents in isolation.
- Production reliability: stateful long-running agents compound errors, so resume from checkpoints instead of restarting, tell the agent when a tool fails so it adapts, and add deterministic retry logic.
- Full production tracing was needed to debug "didn't find obvious info" reports (root causes: bad queries, poor sources, tool failures). Monitor decision patterns and interaction structure, not conversation contents (privacy). Rainbow deployments gradually shift traffic from old to new while both run so mid-flight agents are not broken.
- Synchronous execution is a bottleneck: the lead waits for each subagent batch, blocking steering and coordination while one slow subagent runs. Async would add parallelism at the cost of result coordination, state consistency and error propagation.
- Appendix tips: use end-state evaluation for state-mutating agents with checkpoints where specific state changes should occur; for long-horizon work summarize completed phases, store essentials externally, spawn fresh subagents with clean contexts and careful handoffs, and retrieve the stored plan rather than lose work at the context limit.
- Subagents should write reports, code and data to the filesystem and pass lightweight references to the coordinator, avoiding the "game of telephone" and token overhead. Clio usage data showed specialized software dev 10%, professional/technical content 8%, business strategy 8%, academic 7%, and verifying facts about people/places/orgs 5%.

## Harness implications
- [component:planner] The lead writes its plan to durable memory before it delegates any work.
  > saves the plan to Memory (context past 200k tokens is truncated)
- [stage:build] Give every scout a brief with an objective, an output format, the sources to use and clear boundaries.
  > each subagent brief needs an objective, output format, tool and source guidance, and task boundaries
- [component:taskBudget] Scale effort to task complexity, capping subagents and tool calls per tier and showing tokens spent.
  > simple fact-finding uses 1 agent and 3-10 tool calls
- [component:scouts] Workers keep isolated contexts and return references to filesystem artifacts rather than full content.
  > pass lightweight references to the coordinator
- [component:progressFile] Resume long-running work from checkpoints instead of restarting it.
  > resume from checkpoints instead of restarting
- [foundation:toolHygiene] Report tool failures to the agent as data so it can adapt.
  > tell the agent when a tool fails so it adapts
- [gap] Deploy harness updates rainbow-style so in-flight sessions keep their version.
  > Rainbow deployments gradually shift traffic from old to new
- [foundation:eventLog] Record full traces of decisions, tool calls and interaction structure, with a trace viewer.
  > Full production tracing was needed to debug
- [foundation:ownedLoop] Run independent tool calls in parallel within a turn.
  > subagents issue 3+ tool calls in parallel
- [gap] Let workers complete asynchronously into a results inbox for the lead instead of a batch join.
  > Async would add parallelism at the cost of result coordination
- [component:evaluator] Grade with one LLM judge using a rubric and a pass/fail verdict rather than a panel of judges.
  > One judge was more consistent and human-aligned than multiple judges.
- [stage:evaluate] Judge the outcome and whether the process was reasonable, not whether the agent followed a particular sequence of steps.
  > judge outcomes plus whether the process was reasonable, not step sequences
- [foundation:reliability] Start evals with about 20 representative real tasks rather than waiting for a large suite.
  > About 20 representative real queries suffice early
- [gap] Let an agent test a tool and rewrite its description from the failures it sees.
  > rewrote its description, cutting later task completion time by 40%
- [component:thinkTool] Let workers reason after each tool result to assess its quality and find gaps.
  > use interleaved thinking after each tool result to assess quality
