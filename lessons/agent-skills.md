---
title: Equipping agents for the real world with Agent Skills
date: 2025-10-16
url: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
tags: skills, context, harness, safety
takeaway: Skills package domain expertise as folders with a SKILL.md, loaded by progressive disclosure: only name and description sit in the system prompt, the body loads when relevant, and bundled files and scripts load or run only on demand. This keeps context cost bounded while capability grows, but because skills carry code and instructions, installation needs trust and audit controls.
---

## Learnings
- General-purpose agents (Claude Code is the example) now operate in full computing environments with local code execution and a filesystem. They need composable, scalable, portable ways to acquire domain expertise instead of fragmented, custom-built agents per use case. A skill is "an onboarding guide for a new hire."
- Agent Skills are organized folders of instructions, scripts, and resources that agents discover and load dynamically. A minimal skill is a directory containing `SKILL.md`. Example: the PDF skill that powers Claude's document editing; Claude understands PDFs but cannot manipulate them (e.g. fill a form) without it.
- `SKILL.md` starts with YAML frontmatter; required fields are `name` and `description`. At startup the agent pre-loads the `name` and `description` of every installed skill into its system prompt, and skills are triggered via the system prompt.
- Progressive disclosure is the core design principle. Level 1 is metadata (name and description), enough to know when a skill applies without loading it. Level 2 is the body of `SKILL.md`, read into context when the agent judges it relevant.
- Level 3 and beyond are additional bundled files referenced by name from `SKILL.md` (the PDF skill references `reference.md` and `forms.md`; form-filling lives in `forms.md` so the core stays lean and is read only when filling a form). Analogy: table of contents, then chapters, then appendix. With a filesystem and code execution, the context a skill can bundle is "effectively unbounded."
- Context-window sequence in the PDF example: (1) context holds the core system prompt, metadata for each installed skill, and the user message; (2) Claude triggers the skill by using Bash to read `pdf/SKILL.md`; (3) Claude chooses to read `forms.md`; (4) Claude proceeds using the loaded instructions.
- Skills can include code Claude runs as tools at its discretion. LLMs are bad at some operations (sorting via token generation is far more expensive than running a sort), and many applications need deterministic reliability only code gives.
- The PDF skill ships a pre-written Python script that extracts all form fields; Claude runs it without loading the script or the PDF into context, and the deterministic code makes the workflow consistent and repeatable.
- Developing skills: start with evaluation. Run agents on representative tasks, observe where they struggle or need more context, and build skills incrementally against those gaps.
- Structure for scale: split an unwieldy `SKILL.md` into referenced files, and keep mutually exclusive or rarely co-used contexts on separate paths to reduce tokens. Code serves as both executable tool and documentation, so make it clear whether a script should be run or read as reference.
- Think from Claude's perspective: monitor real usage, watch for unexpected trajectories or overreliance on certain contexts, and pay special attention to `name` and `description`, which drive triggering.
- Iterate with Claude: ask it to capture successful approaches and common mistakes into reusable context and code, and when it goes off track ask it to self-reflect. This reveals what context it actually needs rather than guessing up front.
- Security failure modes: malicious skills can introduce vulnerabilities into the execution environment, direct the agent to exfiltrate data, or cause unintended actions. Install only from trusted sources, audit less-trusted skills thoroughly, read every bundled file (code dependencies, images, scripts), and watch for instructions or code that connect to untrusted external network sources.
- Skills are supported across Claude.ai, Claude Code, Agent SDK, and Developer Platform. Planned: the full lifecycle of creating, editing, discovering, sharing, and using skills. Skills complement MCP by teaching complex workflows over external tools.
- Long-term goal: agents that create, edit, and evaluate their own skills, codifying behavior patterns into reusable capabilities. The format is deliberately simple to ease customization. On 2025-12-18 Agent Skills were published as an open standard (agentskills.io).

## Harness implications
- Implement a skill loader with three disclosure levels: index only name and description into the system prompt, load `SKILL.md` on demand via a file read, and leave deeper files to the agent's own navigation; never pre-load bodies.
- Keep the skill index token cost visible and bounded; lint `name` and `description` for triggering quality since they are the only always-resident text.
- Treat bundled scripts as executable tools the agent can run without reading; distinguish "run this" from "read this" in skill metadata or conventions, and show script executions as tool calls in the UI.
- Provide a skill-authoring loop: after a task, let the agent (or the user) distill successes and mistakes into a skill; support self-reflection prompts when a skill misfires; version skills.
- Gate installation by trust: show provenance, list every bundled file, flag network access and code dependencies, and require explicit approval for skills from untrusted sources; sandbox skill scripts.
- Adopt the open SKILL.md standard for portability across tools, and let skills and MCP servers coexist (skills describe workflows, MCP supplies tools).
- Surface in the UI which skills are installed, which was triggered, and which files it loaded, so users can audit context growth and trigger behavior.
