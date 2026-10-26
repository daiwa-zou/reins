---
title: Building agents with the Claude Agent SDK
date: 2025-09-29
url: https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
tags: harness, tools, context, coding-agents
takeaway: Give the agent a computer and structure it around a loop of gathering context, taking action and verifying work. Prefer agentic file-system search over embeddings, use subagents for parallelism and context isolation, compact automatically, keep tools few and context-efficient, and build concrete verification channels such as lint rules and screenshots. Failures then guide changes to tools and evals built from real usage.
source: post
standing: bundled
components: evaluator, compaction, selfVerification
foundations: ownedLoop
---

## Learnings
- The Claude Code SDK was renamed the Claude Agent SDK because the same loop now powers "almost all of our major agent loops" at Anthropic, including deep research, video creation and note-taking, not just coding.
- Core design principle: Claude needs the tools programmers use (find files, read/write/edit, lint, run, debug, iterate until it works). Terminal access plus file create/edit/search turned out to make Claude effective at non-coding work too: reading CSVs, web search, building visualizations, interpreting metrics.
- Example agent types enabled: finance (portfolio, external APIs, stored data, calculations), personal assistant (travel, calendar, briefs, cross-app context), customer support (ambiguous tickets, collect data, call APIs, message users, escalate to humans), and deep research (search large document collections, synthesize, cross-reference, write reports).
- The agent loop is gather context, take action, verify work, repeat, illustrated with an email agent.
- Agentic search over the file system: files are information that could be loaded, and the agent decides how, using `grep`/`tail` on large logs or uploads instead of loading them whole. "The folder and file structure of an agent becomes a form of context engineering" (e.g. a `Conversations/` folder of past threads).
- Semantic search (chunk, embed, vector query) is usually faster but less accurate, harder to maintain, and less transparent. Recommendation: start with agentic search and add semantic search only for speed or more variation.
- Subagents are built in and serve two purposes: parallelization (several search subagents with different queries at once) and context management (isolated context windows that return only relevant excerpts, not full threads; ideal when most retrieved material is irrelevant).
- Compaction: as the limit approaches, the SDK auto-summarizes prior messages so long-running agents do not run out of context; it is built on Claude Code's `/compact`.
- Tools are the primary building blocks of execution and are prominent in the context window, so design them for context efficiency and make them the agent's primary actions (`fetchInbox`, `searchEmails`). The article points to the separate "Writing effective tools for agents" post.
- Bash and scripts give general-purpose flexibility (download a PDF attachment, convert to text, search it).
- Code generation: code is "precise, composable, and infinitely reusable"; Claude.ai file creation works by writing Python to produce Excel/PowerPoint/Word. Users can express rules as code run on events (inbound-email rules).
- MCP supplies standardized integrations handling auth and API calls (Slack, GitHub, Google Drive, Asana: `search_slack_messages`, `get_asana_tasks`), avoiding custom OAuth glue.
- Verification: agents that check their own output catch errors earlier, self-correct and improve across iterations; the key is concrete evaluation mechanisms.
- Defined rules are the best feedback: clear rules plus which one failed and why. Linting is the canonical case, and TypeScript gives more feedback layers than JavaScript. For email, an invalid address is an error while a never-contacted recipient is a warning.
- Visual feedback: screenshots and renders let the model check layout, styling, hierarchy, and responsiveness. One screenshot has limited viewport info, so use Playwright MCP across viewport sizes and interactive elements.
- LLM-as-judge: a second model grades against fuzzy criteria (does the draft match the user's past tone?). It is "generally not a very robust method" with heavy latency tradeoffs, so use it only where any gain justifies the cost.
- Testing and improving: review outputs, especially failures, and ask whether the agent has the right tools. If it misunderstands the task it lacks information, so restructure search APIs; if it repeatedly fails, add a formal rule to tool calls that identifies and fixes it; if it cannot fix its own errors, give it more useful or creative tools.
- If performance varies as features are added, build a representative eval set from real customer usage. The article does not cover permissions/hooks (announced the same day elsewhere), compaction thresholds, or built-in tool names.

## Harness implications
- [foundation:eventLog] Show the agent's current phase (gathering context, acting, verifying) so a skipped verification is visible.
  > The agent loop is gather context, take action, verify work, repeat
- [foundation:toolHygiene] Default to agentic search with partial reads such as grep and tail, and add embeddings only as an opt-in accelerator.
  > using `grep`/`tail` on large logs or uploads instead of loading them whole
- [foundation:fileHandoff] Treat the workspace's folder and file layout as a designed context surface.
  > "The folder and file structure of an agent becomes a form of context engineering"
- [component:scouts] Offer subagents with isolated context that return only relevant excerpts, for parallel fan-out and a clean main context.
  > isolated context windows that return only relevant excerpts, not full threads
- [component:compaction] Make auto-compaction a harness service, not something the agent must remember to do.
  > the SDK auto-summarizes prior messages so long-running agents do not run out of context
- [component:toolSearch] Keep the tool set small and context-efficient, centred on the agent's primary actions, with Bash as the general escape hatch.
  > design them for context efficiency and make them the agent's primary actions
- [gap] Integrate MCP so third-party auth and API calls need no custom glue.
  > MCP supplies standardized integrations handling auth and API calls
- [component:selfVerification] Feed back deterministic rule and lint results that say which rule failed and why.
  > Defined rules are the best feedback: clear rules plus which one failed and why.
- [gap] Capture screenshots at several viewport sizes so the agent can check layout and responsiveness.
  domains: web
  > use Playwright MCP across viewport sizes and interactive elements
- [component:evaluator] Use an LLM judge only where its gain justifies the cost, since it is not a robust method on its own.
  > It is "generally not a very robust method" with heavy latency tradeoffs
- [foundation:eventLog] Keep failing runs inspectable so tools, not only prompts, can be adjusted from real failures.
  > review outputs, especially failures, and ask whether the agent has the right tools
- [gap] Keep coding assumptions out of the core loop so the same harness serves non-coding agents.
  > Terminal access plus file create/edit/search turned out to make Claude effective at non-coding work too
