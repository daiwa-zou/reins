---
title: Claude Code on the web
date: 2025-10-20
url: https://www.anthropic.com/news/claude-code-on-the-web
tags: sandboxing, coding-agents, infra, safety
takeaway: Running the agent in an isolated cloud sandbox lets users delegate well-scoped coding tasks from a browser, run many in parallel, steer them mid-task and receive a pull request with a summary. Safety rests on default network and filesystem restrictions, user-controlled domain allowlists, and a git proxy that keeps credentials outside the sandbox and limits the agent to authorized repositories.
source: post
standing: bundled
components: osSandbox
foundations: secretsOutside
---

## Learnings
- Browser-based delegation: connect GitHub repositories, describe the task, and Claude implements on Anthropic-managed cloud infrastructure with no terminal. It began as a beta research preview for Pro and Max users, and the page was updated September 23, 2026 to say "cloud sessions" are now GA for Pro, Max, Team and some Enterprise seats.
- Parallel tasks run across different repositories from one interface, each session in its own isolated environment.
- Real-time progress tracking is available, with the ability to steer Claude mid-task.
- Automatic PR creation and change summaries arrive at the end of a task.
- An early iOS mobile preview was included.
- Security model: every task runs in an isolated sandbox with network and filesystem restrictions.
- Git operations go through a secure git proxy that limits Claude to authorized repositories, protecting code and credentials.
- Custom network configuration lets users choose which domains are reachable (e.g. allow npm so tests can run). The post points to the engineering sandboxing post and docs for details.
- Recommended uses: questions about how a project works and repository mapping; bug fixes and routine well-defined tasks; and backend changes where Claude can verify via test-driven development.
- Cloud sessions share rate limits with other Claude Code usage.

## Harness implications
- Design the harness so the same agent core runs locally and in a remote sandbox; the UI becomes a thin client showing progress, allowing steering, and receiving a PR plus summary.
- Sandbox each session with default-deny network and an allowlist of domains the user controls; credentials never enter the sandbox, with git mediated by a proxy scoped to authorized repos.
- Multi-session dashboards (many repos, many tasks) need a compact status view with per-session steering and results, not a single transcript.
- Well-scoped, verifiable tasks (bug fixes, backend with tests) are the sweet spot for unattended cloud runs; the UI can nudge users toward tasks with a verification path.
- End-of-task artifacts (PR, summary of changes) should be the primary deliverable surfaced to the user.
- Shared quotas across surfaces imply a unified budget display.
