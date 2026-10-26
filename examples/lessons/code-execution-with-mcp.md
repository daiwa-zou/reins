---
title: Code execution with MCP: Building more efficient agents
date: 2025-11-04
url: https://www.anthropic.com/engineering/code-execution-with-mcp
tags: mcp, tools, context, sandboxing
takeaway: Loading every MCP tool definition up front and routing each intermediate result through the model burns hundreds of thousands of tokens. Presenting MCP servers as a typed code API on a filesystem lets the agent discover tools on demand, filter data in a sandbox, and keep sensitive values out of context, cutting one example from 150,000 to 2,000 tokens, at the cost of needing a secure execution environment.
source: post
standing: bundled
components: toolSearch
foundations: toolHygiene
---

## Learnings
- MCP is an open standard (launched Nov 2024) connecting agents to external systems, with thousands of community servers, SDKs in all major languages, and de facto standard status. The scaling problem is that agents with hundreds or thousands of tools across dozens of servers pay for every definition up front and route every intermediate result through the context window.
- Cost pattern 1, tool definitions overload context: most MCP clients load every tool definition up front in direct tool-calling syntax (e.g. `gdrive.getDocument(documentId, fields?)`, `salesforce.updateRecord(objectType, recordId, data)`). With thousands of tools an agent may process hundreds of thousands of tokens before reading the request, raising latency and cost.
- Cost pattern 2, intermediate results consume tokens: fetching a meeting transcript from Drive and attaching it to a Salesforce lead sends the full transcript through the model twice (read, then re-emitted into the update call). A 2-hour meeting adds about 50,000 tokens, very large documents can exceed the window and break the workflow, and large data increases copy errors between calls.
- Core idea: present MCP servers as code APIs and let the agent write code to use them. The layout is `servers/<server>/<tool>.ts` plus `index.ts` (e.g. `servers/google-drive/getDocument.ts`), where each file exports a typed async function wrapping a shared `callMCPTool` helper with a namespaced tool name such as `google_drive__get_document`. The agent lists `./servers/` to discover servers and reads only the tool files it needs.
- The transcript example becomes two lines (read document, pass `content` to `updateRecord`) and the model never sees the text. Reported saving: 150,000 tokens to 2,000 tokens, 98.7%. Cloudflare independently reported the same pattern ("Code Mode"); the insight is that LLMs are good at writing code.
- Progressive disclosure: models navigate filesystems well, so tool definitions are read on demand. An alternative is a `search_tools` tool on the server (search "salesforce" returns relevant tools) with a detail-level parameter (name only, name plus description, or full schema) to conserve context.
- Context-efficient tool results: fetching a 10,000-row sheet, code filters `Status == pending`, logs the count and the first 5 rows, so the agent sees 5 rows instead of 10,000. The same applies to aggregations, joins across sources, and field extraction.
- Control flow in code: loops, conditionals, retries and error handling run in familiar code instead of chained tool calls. For example, polling Slack channel history for "deployment complete" with 5000 ms sleeps is cheaper than alternating tool call and sleep through the agent loop, and conditionals run in the sandbox without consulting the model, reducing latency and time to first token.
- Privacy-preserving operations: intermediate results stay in the execution environment by default, and the model sees only what is logged or returned. The harness can tokenize PII automatically (`[EMAIL_1]`, `[PHONE_1]`, `[NAME_1]`) and the MCP client detokenizes via lookup when data is passed to another tool, so contacts move from Google Sheets to Salesforce Leads without the model seeing real values.
- Tokenization prevents accidental logging or processing of PII and enables deterministic rules about where data may flow.
- State persistence and skills: agents write intermediate results to files (`./workspace/leads.csv`) and resume later, and save working code as reusable functions (`./skills/save-sheet-as-csv.ts`). Adding a `SKILL.md` turns saved functions into a structured Agent Skill, so over time the agent builds a toolbox of higher-level capabilities and evolves its own scaffolding.
- Caveat: code execution adds complexity. It needs a secure execution environment with sandboxing, resource limits, and monitoring, plus operational overhead and security considerations that direct tool calls avoid. Weigh token savings, latency, and composition gains against those costs (see the Claude Code sandboxing post).
- Framing: context management, tool composition, and state persistence have known software-engineering solutions, and code execution applies them to agents. The authors invite findings from the MCP community.

## Harness implications
- [component:toolSearch] Let the agent discover tool definitions on demand, reading only the ones it needs instead of loading every definition up front.
  > The agent lists `./servers/` to discover servers and reads only the tool files it needs.
- [component:osSandbox] Run agent-written code in a sandbox with resource limits, network policy and monitoring.
  > It needs a secure execution environment with sandboxing, resource limits, and monitoring
- [foundation:toolHygiene] Filter, aggregate and extract large results in code so only a compact summary reaches the model.
  > code filters `Status == pending`, logs the count and the first 5 rows
- [gap] Tokenize PII at the harness boundary so the model sees placeholders and data-flow rules are deterministic policy.
  > The harness can tokenize PII automatically
- [foundation:fileHandoff] Give the agent a persistent workspace for intermediate files so work can resume later.
  > agents write intermediate results to files (`./workspace/leads.csv`) and resume later
- [component:skills] Let the agent save reusable code with a SKILL.md as a skill the user can browse and edit.
  > Adding a `SKILL.md` turns saved functions into a structured Agent Skill
- [component:narration] Show a polling or retry script as one running step with live logs instead of one row per tool call.
  > conditionals run in the sandbox without consulting the model
- [gap] Keep direct tool calls for simple one-shot calls, use code execution for large or chained results, and show which mode is in use.
  > Weigh token savings, latency, and composition gains against those costs
- [foundation:eventLog] Log every code execution: the code, the tool calls it made, bytes in and out, and what entered context.
  > sandboxing, resource limits, and monitoring
