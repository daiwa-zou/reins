---
title: Writing effective tools for AI agents — with AI agents
date: 2025-09-11
url: https://www.anthropic.com/engineering/writing-tools-for-agents
tags: tools, evals, mcp, context
takeaway: A tool is a contract between a deterministic system and a non-deterministic agent, so design it for the agent: few consolidated tools with distinct purposes, namespaced names, semantic rather than opaque outputs, token-efficient and truncated results, and descriptions written like onboarding docs. Build tools through a prototype, evaluate, analyze, improve loop on realistic multi-call tasks, and let Claude analyze transcripts and refactor the tools.
domains: cli
enables: selfVerification
guidance: Make errors actionable: on bad input, say what was expected and give an example, on stderr with a non-zero exit code.
---

## Learnings
- Traditional software is a contract between deterministic systems (`getWeather("NYC")` always behaves the same). A tool is a contract between a deterministic system and a non-deterministic agent that may call it, answer from knowledge, or ask a clarifying question, and may hallucinate or misunderstand it. So tools must be designed for agents, not written like APIs for developers, to widen the set of tasks agents can solve by enabling multiple successful strategies. Agent-ergonomic tools also tend to be intuitive for humans.
- Development loop: prototype, evaluate, analyze, improve, repeated against real-world tasks.
- Prototyping: give Claude Code documentation for libraries and SDKs (LLM-friendly `llms.txt` files). Test by wrapping tools in a local MCP server or Desktop Extension (`claude mcp add <name> <command> [args...]`, Claude Desktop `Settings > Developer` / `Settings > Extensions`, or pass tools directly to the API), then test manually and collect user feedback.
- Evaluation design: generate many tasks grounded in real use with realistic data (internal KBs, microservices) and avoid toy sandboxes. Strong tasks may need dozens of tool calls (e.g. "schedule a meeting with Jane next week about Acme, attach prior planning notes, book a room"; "customer charged three times — find logs and other affected customers"; "prepare a retention offer"), while weak tasks are one-call lookups.
- Each task needs a verifiable outcome (exact-match or LLM judge), avoiding verifiers that fail on formatting or punctuation. Optionally list expected tools, but do not overspecify strategies.
- Running evals: use simple agentic `while` loops over direct API calls, one per task. Ask agents to emit reasoning and feedback blocks before tool calls (or enable interleaved thinking) to see why they call or skip tools, and collect accuracy, runtime of calls and tasks, total tool calls, total tokens, and tool errors. Call tracking reveals workflows and consolidation opportunities.
- Analysis: read CoT and raw transcripts, since what agents omit can matter more than what they say. Many redundant calls mean right-size pagination and token limits; many invalid-parameter errors mean clearer descriptions and examples. In one case Claude kept appending `2025` to the web search `query`, biasing results, which was fixed by rewriting the description.
- Collaborate with agents: concatenate transcripts and paste them into Claude Code to analyze and refactor tools, keeping implementation and description self-consistent. Held-out test sets guard against overfitting, and Claude-optimized Slack and Asana MCP servers beat hand-written "expert" tools on held-out sets.
- Principle 1, choose the right tools: more tools is not better, and do not just wrap existing endpoints. Agents have limited context while computer memory is cheap, so `list_contacts` dumping everything wastes context; prefer `search_contacts` / `message_contact`.
- Consolidation examples: `list_users` + `list_events` + `create_event` becomes `schedule_event`; `read_logs` becomes `search_logs` (relevant lines plus surrounding context); `get_customer_by_id` + `list_transactions` + `list_notes` becomes `get_customer_context`. Each tool should have one distinct purpose; build a few tools for high-impact workflows, then scale.
- Principle 2, namespace: prefix by service (`asana_search`, `jira_search`) and/or resource (`asana_projects_search`, `asana_users_search`). Prefix vs. suffix had non-trivial, model-dependent eval effects, so decide by your own evals. This addresses wrong tool, wrong params, too few calls, and mishandled responses.
- Principle 3, return meaningful context: prefer `name`, `image_url`, `file_type` over `uuid`, `256px_image_url`, `mime_type`. Resolving UUIDs to semantic names (or 0-indexed schemes) raised retrieval precision and cut hallucinations.
- When IDs are needed for chaining (`search_user(name='jane')` then `send_message(id=12345)`), add a `response_format` enum (`"concise"` | `"detailed"`; extensible GraphQL-style). Measured on Slack threads, detailed was 206 tokens vs concise 72 tokens (about one third), with detailed carrying `thread_ts`, `channel_id`, and `user_id`. Output structure (XML/JSON/Markdown) has no universal best, so pick by eval.
- Principle 4, token efficiency: use pagination, range selection, filtering, and truncation with sensible defaults. Claude Code caps tool responses at 25,000 tokens by default, and when truncating, responses should include instructions steering the agent to token-efficient strategies (many small targeted searches rather than one broad one). Errors must be actionable (specific fixes, correctly formatted examples), not opaque codes or tracebacks.
- Principle 5, prompt-engineer descriptions and specs, one of the most effective levers: describe the tool as to a new hire, making implicit context explicit (query formats, niche terminology, resource relationships). Describe inputs and outputs clearly and enforce with strict data models, and use unambiguous parameter names (`user_id` not `user`).
- Precise description refinements took Claude Sonnet 3.5 to SOTA on SWE-bench Verified. Use MCP tool annotations to disclose open-world access or destructive effects.
- Effective tools are intentionally and clearly defined, judicious with context, composable across workflows, and enable intuitive real-world solutions. Keep an evaluation-driven process as MCP and models evolve.

## Harness implications
- Ship an eval harness alongside the tool registry: task files with verifiable outcomes, a `while`-loop runner, and metrics (accuracy, calls, tokens, latency, errors) plus held-out sets; make transcript review and "paste transcripts to the agent to refactor tools" a built-in workflow.
- Cap tool-result size (about 25K tokens default) with truncation messages that teach the agent a better strategy, and offer pagination, range and filter params on every potentially large tool.
- Give large-result tools a `response_format` (concise/detailed) and default to concise; surface semantic names instead of raw IDs in results, with IDs available on request.
- Enforce namespacing (`service_resource_action`) and a registry lint that flags overlapping tools, vague descriptions, ambiguous parameter names, and placeholder descriptions.
- Make tool errors first-class, actionable messages (expected format, example input), and show them distinctly in the UI so users can spot description problems.
- Surface tool annotations (read-only / destructive / open-world) in the UI and use them for permission gating.
- Record per-tool call counts and error rates in the session and expose a "tool health" view to drive consolidation decisions.
- Prefer consolidated workflow tools over thin endpoint wrappers when designing the harness's own built-ins (search over list, context bundles over N lookups).
