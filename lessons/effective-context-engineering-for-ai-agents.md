---
title: Effective context engineering for AI agents
date: 2025-09-29
url: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
tags: context, harness, long-running, multi-agent
takeaway: Context is a finite attention budget with diminishing returns, so the goal is the smallest set of high-signal tokens that produces the desired behavior, curated afresh every turn. Load data just in time via lightweight identifiers, keep tools and prompts at the right altitude, and for long tasks use compaction, structured note-taking or sub-agents with condensed returns, chosen by the shape of the task.
source: post
standing: bundled
components: scouts, progressFile, projectMemory, compaction, contextEditing, skills
foundations: cacheAsSignal
---

## Learnings
- Context is the full set of tokens included when sampling from the LLM: system instructions, tools, MCP definitions, external data, message history. Context engineering asks "what configuration of context is most likely to generate our model's desired behavior?" It is the successor to prompt engineering and is iterative, because an agent in a loop keeps generating more candidate data and curation happens every turn. The agent definition used is "LLMs autonomously using tools in a loop."
- Context rot: needle-in-a-haystack benchmarks show recall accuracy falls as token count grows, across all models (rates differ). Causes include n² pairwise attention, fewer long-sequence training examples, and position-encoding interpolation. Degradation is a gradient not a cliff, hence the "attention budget" metaphor: every token depletes it, and context has diminishing marginal returns.
- Guiding principle: find the smallest possible set of high-signal tokens that maximizes the likelihood of the desired outcome. "Informative, yet tight."
- System prompts should sit at the "right altitude" (Goldilocks zone). Failure mode A is brittle hard-coded if-else logic (fragile, costly to maintain); failure mode B is vague high-level guidance that assumes shared context. Aim for specific enough to guide, flexible enough to give strong heuristics.
- Organize prompts into sections (`<background_information>`, `<instructions>`, `## Tool guidance`, `## Output description`) with XML tags or Markdown headers; exact formatting matters less as models improve. "Minimal" is not "short": start minimal on the best model and add instructions or examples only in response to observed failures.
- Tools are the contract between the agent and its information and action space; they must be token-efficient and encourage efficient behavior. They should be self-contained, robust to error, clear in intended use, with descriptive unambiguous parameters and minimal functional overlap. Bloated tool sets with ambiguous choices are a failure mode: if a human engineer cannot say definitively which tool to use, the agent cannot either.
- Few-shot examples remain strongly recommended. The anti-pattern is a laundry list of edge-case rules; the recommendation is a diverse set of canonical examples ("pictures worth a thousand words").
- Just-in-time (JIT) retrieval vs. pre-retrieval: traditional systems run embedding retrieval before inference, while JIT agents keep lightweight identifiers (file paths, stored queries, links) and load with tools at runtime. Claude Code writes targeted queries and uses `head`/`tail` to inspect large data without loading whole objects.
- Metadata is signal: `tests/test_utils.py` vs `src/core_logic/test_utils.py`, folder hierarchy, naming conventions, timestamps (relevance proxy), and file size (complexity hint). Progressive disclosure means each interaction informs the next, and only what is necessary stays in working memory.
- Trade-offs of JIT: it is slower than precomputed retrieval, needs good tools and heuristics, and without guidance agents waste context chasing dead ends or misusing tools.
- Hybrid strategy: load some context up front for speed, explore autonomously after. Claude Code drops `CLAUDE.md` files into context up front, then uses glob/grep JIT, avoiding stale indexes and syntax trees. Hybrid suits less dynamic domains (legal, finance). Advice: "do the simplest thing that works," and expect less human curation as models improve.
- Long-horizon tasks (tens of minutes to hours; migrations, deep research) exceed any window, and bigger windows alone do not fix pollution or relevance. Three techniques follow, chosen by task shape.
- Compaction summarizes near-full history and starts a new window. Claude Code passes history to the model to summarize, preserves architectural decisions, unresolved bugs and implementation details, discards redundant tool outputs and messages, and resumes with compressed context plus the five most recently accessed files. Tune on complex traces: maximize recall first, then improve precision; over-aggressive compaction loses subtle details.
- The lightest form of compaction is tool result clearing (drop raw results deep in history), now a Claude Developer Platform feature.
- Structured note-taking or agentic memory has the agent regularly write notes to persistent storage outside the window and read them back (Claude Code to-do lists; a `NOTES.md`). Claude playing Pokémon kept tallies over thousands of steps (e.g. 1,234 steps on Route 1, Pikachu +8 levels toward a target of 10), built maps, tracked achievements and recorded which attacks beat which opponents without being told a memory schema, and read its notes after resets to continue multi-hour sequences.
- The memory tool (public beta with Sonnet 4.5) provides file-based storage outside the window for knowledge bases and cross-session project state.
- Sub-agent architectures have a lead agent hold the plan while specialized sub-agents work in clean windows, may burn tens of thousands of tokens, and return a condensed summary of about 1,000-2,000 tokens. Search detail stays isolated and the lead agent synthesizes; the multi-agent research system showed substantial gains over single-agent.
- Choosing: compaction for extensive back-and-forth needing conversational flow; note-taking for iterative development with clear milestones; multi-agent for complex research where parallel exploration pays off.
- Conclusion: the shift is from crafting a perfect prompt to curating what enters the limited attention budget at each step; smarter models need less prescription but context stays finite.

## Harness implications
- [component:taskBudget] Treat the context window as a budgeted resource and track how many tokens each source (system prompt, tool definitions, tool results, history) uses.
  > every token depletes it, and context has diminishing marginal returns
- [gap] Show the context cost of each tool call in the UI so pollution is visible where it happens.
  > Degradation is a gradient not a cliff
- [component:compaction] Compaction should preserve decisions, open bugs and implementation details, discard stale tool output, and leave a summary the user can inspect.
  > preserves architectural decisions, unresolved bugs and implementation details, discards redundant tool outputs and messages
- [component:contextEditing] Clear old tool results automatically before full compaction is needed, keeping a pointer so the agent can re-fetch them.
  > tool result clearing (drop raw results deep in history)
- [component:progressFile] Persistent notes outside the context window survive resets and sessions and show the agent's working state.
  > write notes to persistent storage outside the window and read them back
- [component:scouts] Sub-agents work in isolated contexts and return a bounded summary of about 1-2K tokens, never their raw transcript.
  > return a condensed summary of about 1,000-2,000 tokens
- [foundation:toolHygiene] Favour just-in-time retrieval with targeted queries and head/tail over loading whole objects or pre-indexed dumps.
  > Claude Code writes targeted queries and uses `head`/`tail` to inspect large data without loading whole objects
- [component:projectMemory] Load a small project-memory bootstrap such as CLAUDE.md up front and explore the rest just in time.
  > Claude Code drops `CLAUDE.md` files into context up front
- [component:toolSearch] Keep the loaded tool set small and non-overlapping, because if a human cannot say which tool to use the agent cannot either.
  > if a human engineer cannot say definitively which tool to use, the agent cannot either
- [stage:plan] Write the spec at the right altitude: specific enough to guide the builder, flexible enough to leave it strong heuristics, never brittle if-else rules.
  > Aim for specific enough to guide, flexible enough to give strong heuristics.
- [component:toolExamples] Prefer a few diverse canonical examples over a laundry list of edge-case rules.
  > the recommendation is a diverse set of canonical examples
- [component:compaction] Choose among compaction, note-taking and sub-agents by task shape, and make the active one visible to the user.
  > compaction for extensive back-and-forth needing conversational flow; note-taking for iterative development with clear milestones
