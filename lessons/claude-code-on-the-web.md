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
- [foundation:eventLog] Keep the UI a thin client over the run's events, showing progress, allowing mid-task steering and receiving the result.
  > Real-time progress tracking is available, with the ability to steer Claude mid-task.
- [component:osSandbox] Run every session in a sandbox with network and filesystem restrictions and a domain allowlist the user controls.
  > every task runs in an isolated sandbox with network and filesystem restrictions
- [foundation:secretsOutside] Keep credentials out of the sandbox and mediate git through a proxy scoped to authorized repositories.
  > Git operations go through a secure git proxy that limits Claude to authorized repositories
- [foundation:eventLog] Give many parallel sessions a compact status view with per-session steering and results, not a single transcript.
  > Parallel tasks run across different repositories from one interface
- [stage:contract] Prefer criteria that have a verification path the builder can run, such as tests, over criteria only a person can judge.
  > backend changes where Claude can verify via test-driven development
- [foundation:reviewIntent] Make the end-of-task summary of changes the primary deliverable shown to the user.
  > Automatic PR creation and change summaries arrive at the end of a task.
- [component:taskBudget] Show one budget across surfaces when they share a quota.
  > Cloud sessions share rate limits with other Claude Code usage.
