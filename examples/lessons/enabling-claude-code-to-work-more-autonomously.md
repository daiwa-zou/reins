---
title: Enabling Claude Code to work more autonomously
date: 2025-09-29
url: https://www.anthropic.com/engineering/enabling-claude-code-to-work-more-autonomously
tags: coding-agents, harness, long-running, reliability
takeaway: Autonomy needs safety nets and deterministic hooks, not just a better model. Checkpoints that snapshot code before every edit make users willing to delegate large refactors, hooks give guarantees at lifecycle points that advisory instructions cannot, and subagents plus background tasks let work proceed in parallel. Build one UI-agnostic engine and expose it across terminal, IDE and SDK surfaces.
source: post
standing: bundled
components: scouts
foundations: eventLog
---

## Learnings
- The announcement shipped alongside Claude Code 2.0 and the Sonnet 4.5 launch, and the default model became Claude Sonnet 4.5 (`/model` to switch).
- A native VS Code extension (beta) adds a dedicated sidebar panel showing Claude's changes in real time with inline diffs, for people who prefer an IDE to a terminal.
- Terminal 2.0 is a refreshed interface with improved status visibility and searchable prompt history via `Ctrl+R` to reuse or edit earlier prompts.
- The Claude Agent SDK (renamed from Claude Code SDK) exposes the same core tools, context management and permissions framework that power Claude Code, now with subagents and hooks. Example agents: financial compliance, cybersecurity, code debugging.
- Checkpoints: code state is saved automatically before each change, and users rewind with `Esc Esc` or `/rewind`, restoring code, conversation, or both. They cover only Claude's edits, not user edits or Bash commands, so use them alongside version control.
- Subagents delegate specialized work (a backend API while the main agent builds the frontend) for parallel workflows.
- Hooks trigger actions at set points, e.g. run the test suite after code changes or lint before commits.
- Background tasks keep long-running processes like dev servers alive without blocking other work. Together with checkpoints these let users delegate broad tasks such as large refactors or feature exploration.

## Harness implications
- [component:gitCommits] Checkpoint workspace state before agent edits so code can be restored independently of the conversation.
  > code state is saved automatically before each change
- [component:gitCommits] Say plainly what checkpoints do not cover, such as shell side effects, and build them on git rather than replacing it.
  > They cover only Claude's edits, not user edits or Bash commands, so use them alongside version control.
- [gap] Manage the lifecycle of long-lived background processes such as dev servers so the agent can keep working while they run.
  > Background tasks keep long-running processes like dev servers alive without blocking other work.
- [component:selfVerification] Run deterministic checks such as tests or lint at fixed lifecycle points rather than relying on advisory instructions.
  > run the test suite after code changes or lint before commits
- [component:scouts] Build subagents into the engine layer so every surface gets them.
  > now with subagents and hooks
- [foundation:eventLog] Keep the engine UI-agnostic, streaming the same run events to every surface, including real-time diffs.
  > showing Claude's changes in real time with inline diffs
- [gap] Offer searchable prompt history for iterative steering.
  > searchable prompt history via `Ctrl+R`
