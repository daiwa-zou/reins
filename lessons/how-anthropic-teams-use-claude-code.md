---
title: How Anthropic teams use Claude Code
date: 2025-07-24
url: https://www.anthropic.com/news/how-anthropic-teams-use-claude-code
tags: coding-agents, harness, multi-agent
takeaway: The most successful internal teams treat Claude Code as a thought partner rather than a code generator, spanning debugging, codebase navigation, testing, prototyping and automation, including non-engineers. Concrete artifacts such as stack traces and screenshots, pseudocode-first test-driven loops with periodic check-ins, and narrow specialized subagents drove the biggest gains. A harness should support both tight pairing and delegated work.
source: post
standing: bundled
components: projectMemory
foundations: reviewIntent
---

## Learnings
- Overall takeaway: the most successful teams treat Claude Code as a thought partner rather than a code generator. Usage spans debugging, codebase navigation, testing, prototyping, documentation and automation, including non-engineering teams.
- Infrastructure and data scientists: new hires point Claude at the whole codebase; it reads the CLAUDE.md files, explains pipeline dependencies and which upstream sources feed each dashboard, replacing traditional data-catalog tools. Plain-text descriptions of data workflows get fully automated execution.
- Product Engineering: Claude Code is the first stop for any task. It identifies which files to examine for a bug, feature or analysis, removing manual context gathering, and lets engineers fix bugs in unfamiliar codebases without waiting on owning teams.
- Product Design: Claude writes comprehensive tests, and GitHub Actions automate PR comments with Claude doing formatting and test refactoring. Figma files are fed to Claude Code followed by autonomous write-code/run-tests/iterate loops (it built Vim key bindings for itself with minimal review), and Claude maps error states, logic flows and system statuses during design to find edge cases early.
- Security Engineering: the old loop "design doc, janky code, refactor, give up on tests" was replaced by asking for pseudocode first, guiding test-driven development, and checking in periodically.
- During incidents, security engineers feed in stack traces and docs to trace control flow, so 10-15 minute manual scans resolve about 3x faster. Claude also ingests documentation to produce markdown runbooks and troubleshooting guides reused as debugging context.
- Inference: team members describe tests in unfamiliar languages (Rust) and Claude writes them in the codebase's native language. Non-ML members ask Claude to explain model-specific functions, cutting an hour of research to 10-20 minutes (about an 80% reduction).
- Data Infrastructure: when Kubernetes stopped scheduling pods, dashboard screenshots were shared and Claude walked the team menu by menu through the Google Cloud UI to find IP exhaustion and gave the commands to add an IP pool, saving about 20 minutes during an outage.
- Data Science (RL visualization): people without TypeScript built React dashboards via one-shot prompts in a sandbox, tweaking lightly and never needing to read the generated code.
- Growth Marketing: an agentic workflow reads CSVs of hundreds of ads, finds underperformers and generates variants under strict character limits using two specialized subagents, producing hundreds of ads in minutes instead of hours. A Figma plugin generates up to 100 variations per frame.
- Legal built prototype "phone tree" tools to route employees to the right lawyer.
- Implied practices: maintain CLAUDE.md and use MCP to consolidate scattered docs; pseudocode first, then TDD, with periodic check-ins instead of constant supervision; provide concrete artifacts during incidents (stack traces, screenshots).
- More implied practices: hand over abstract problems, let Claude work autonomously and review before final refinement; use sandboxed one-shot prompting for low-stakes work and iterate only if needed; use specialized subagents for high-volume generation; share discoveries across technical and non-technical staff.

## Harness implications
- [foundation:declarativeConfig] Support both tight pairing and "delegate, check in periodically" as a run setting, surfacing the check-in points.
  > periodic check-ins instead of constant supervision
- [gap] Accept screenshots and pasted logs as first-class task inputs.
  > dashboard screenshots were shared
- [component:scouts] Make read-only exploration of a codebase cheap and safe.
  > It identifies which files to examine for a bug, feature or analysis
- [component:projectMemory] Keep a project knowledge layer such as CLAUDE.md and runbooks that the agent reads and can update.
  > it reads the CLAUDE.md files
- [stage:tests] Write the whole suite for the package up front, failure paths included, rather than one test per feature as it is built.
  > Claude writes comprehensive tests
- [component:testsFirst] Guide the work with tests written first instead of letting tests be the step that is given up on.
  > guiding test-driven development
- [component:selfVerification] Run build, test and iterate loops against a design artifact and keep visual evidence of the result.
  domains: web
  > Figma files are fed to Claude Code followed by autonomous write-code/run-tests/iterate loops
- [component:narration] Let non-engineers follow a run in plain language without reading code.
  > never needing to read the generated code
- [component:scouts] Make specialized subagents with narrow prompts easy to define and reuse for repetitive work.
  > using two specialized subagents
- [component:publish] Treat the pull request's review comments and check results as input the harness acts on, not a person's chore.
  > GitHub Actions automate PR comments
- [foundation:declarativeConfig] Let runs start headless from CI or events using the same declarative run config.
  > GitHub Actions automate PR comments
