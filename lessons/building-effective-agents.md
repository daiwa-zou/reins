---
title: Building effective agents
date: 2024-12-19
url: https://www.anthropic.com/engineering/building-effective-agents
tags: harness, tools, multi-agent, reliability
takeaway: The most successful agent systems use simple, composable patterns rather than heavy frameworks. Start with the simplest thing that works, move to workflows (chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) only when evals show gains, and reserve open-ended agents for problems where steps are unpredictable. Invest as much in tool design and transparency as in prompts, because the agent-computer interface decides success.
source: post
standing: bundled
components: contracts, evaluator
foundations: ownedLoop
---

## Learnings
- "Agentic systems" is the umbrella term. Workflows orchestrate LLMs and tools through predefined code paths, while agents let the LLM dynamically direct its own process and tool use. The most successful implementations across dozens of teams used simple, composable patterns, not complex frameworks.
- Start with the simplest solution; often a single optimized LLM call with retrieval and in-context examples is enough. Agentic systems trade latency and cost for task performance: use workflows for predictable, well-defined tasks and agents for flexible, model-driven decisions at scale.
- Frameworks (Claude Agent SDK, Strands, Rivet, Vellum) simplify calling, tool parsing and chaining, but add abstraction that hides prompts and responses, hinders debugging and tempts over-complexity. Start with the raw API (many patterns are a few lines); if you use a framework, understand the code underneath, because wrong assumptions about it are a common customer error.
- The building block is the augmented LLM: an LLM plus retrieval, tools and memory. Models can generate their own search queries, select tools, and decide what to retain. Tailor these to the use case and give a clear, well-documented interface; MCP is one integration route.
- Prompt chaining: sequential steps, each processing the previous output, with programmatic gates checking intermediate results. Use when the task decomposes into fixed subtasks; it trades latency for accuracy (e.g. write copy then translate; outline, check criteria, draft).
- Routing: classify input and dispatch to a specialized prompt or process. Use when distinct categories are handled better separately and can be classified accurately (e.g. support query types; easy questions to Haiku 4.5, hard ones to Sonnet 4.5).
- Parallelization comes as sectioning (independent subtasks in parallel) and voting (same task several times for diverse outputs). Use for speed or multiple perspectives, with each concern getting its own focused call (e.g. a guardrail model screens while another answers; evals scoring different aspects; several reviewers voting on vulnerabilities or inappropriate content with tunable thresholds).
- Orchestrator-workers: a central LLM dynamically decomposes the task, delegates to workers, and synthesizes. Use when subtasks cannot be predicted in advance (coding changes across an unknown number of files; multi-source search). It differs from parallelization because subtasks are decided at runtime.
- Evaluator-optimizer: one call generates, another evaluates and feeds back, in a loop. Use when evaluation criteria are clear, iteration demonstrably adds value, and the LLM can produce useful feedback (e.g. literary translation critique; multi-round search deciding whether more searching is needed).
- Autonomous agents start from a human command or discussion; once the task is clear they plan and operate independently, returning for information or judgment when needed. They must obtain ground truth from the environment at each step (tool results, code execution), can pause at checkpoints or blockers for human feedback, and should include stopping conditions such as a maximum iteration count.
- Implementation is often just an LLM using tools in a loop on environmental feedback; the hard part is tool design and documentation. Use agents for open-ended problems with unpredictable step counts where the model's decisions can be trusted. Risks are higher cost and compounding errors, so test extensively in sandboxes with guardrails. Anthropic examples: a SWE-bench coding agent editing many files and the computer-use reference implementation.
- Core principles: simplicity, transparency (explicitly show the agent's planning steps), and a well-crafted agent-computer interface (ACI) with thorough tool documentation and testing. In production, reduce abstraction layers and build from basic components; measure, then add complexity only when it demonstrably helps.
- Where agents pay off: tasks needing conversation plus action, clear success criteria, feedback loops, and meaningful human oversight. Customer support fits (tools for customer data, orders, KB; programmatic refunds; measurable resolution; usage-based pricing on successful resolutions).
- Coding agents fit because automated tests verify the work and the agent can iterate on test results; SWE-bench Verified is solved from the PR description alone, though human review is still essential for alignment with broader requirements.
- Tool definitions deserve as much prompt engineering as the main prompt. Format matters: diffs force counting changed lines before writing code, and code inside JSON needs escaping of newlines and quotes. Give the model tokens to think before committing to output, keep formats close to what appears naturally in internet text, and avoid formatting overhead such as counting thousands of lines or escaping strings.
- Put yourself in the model's shoes: if a tool is hard to use from its description and parameters, it is hard for the model. Include example usage, edge cases, input-format requirements, and clear boundaries from other tools; rename parameters and rewrite docstrings as for a junior developer; test with many inputs in the Workbench.
- Poka-yoke your tools: change arguments so mistakes are harder. On SWE-bench more time went into tools than the prompt, and relative-path errors after `cd` were fixed completely by requiring absolute paths. (The page carries a later note that the tooling landscape has changed and points to Managed Agents.)

## Harness implications
- Offer the five workflow patterns (chaining with gates, routing, sectioning/voting parallelization, orchestrator-workers, evaluator-optimizer) as composable primitives alongside a free agent loop, and let users pick the least autonomous one that works.
- Keep the harness thin and inspectable: raw prompts, tool schemas and responses must be viewable; avoid abstraction that hides them.
- Show planning steps in the UI (transparency principle) and ground every step in environment feedback that is also displayed.
- Build in stopping conditions (max iterations, budget), checkpoints where the agent pauses for human judgment, and sandboxed execution for compounding-error risk.
- Treat tool definitions as a first-class, testable artifact: a tool workbench for trying many inputs, docstring-quality descriptions, examples and edge cases, and poka-yoke constraints such as absolute paths and exact-match edits.
- Choose output formats that match natural text (string replacement over diffs, markdown over JSON-embedded code) to reduce model error.
- Routing should allow model tiering (cheap model for easy inputs) and voting should expose tunable thresholds.
- Measure outcomes and add complexity only when evals show gains; the harness should make that measurement easy.
