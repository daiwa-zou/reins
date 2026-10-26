---
title: Beyond permission prompts: making Claude Code more secure and autonomous
date: 2025-10-20
url: https://www.anthropic.com/engineering/claude-code-sandboxing
tags: sandboxing, safety, coding-agents, infra
takeaway: Constant permission prompts cause approval fatigue and make agents less safe, so Claude Code instead defines OS-level boundaries inside which it acts freely. Filesystem and network isolation are only effective together, egress goes through a proxy outside the sandbox, and credentials stay outside entirely. Internally this cut permission prompts by 84%, though no baseline or methodology was given.
source: post
standing: bundled
components: actionClassifier, osSandbox
---

## Learnings
- Claude Code writes, tests, and debugs code, edits many files, and runs commands; this broad access creates risk, especially from prompt injection.
- The default permission model is read-only: it asks permission before modifications or commands, and a few safe commands (e.g. `echo`, `cat`) are auto-allowed.
- Constant approval requests produce approval fatigue: users stop scrutinizing what they approve, making development less safe, not more.
- The sandboxing approach defines boundaries inside which Claude acts freely, reducing per-action prompts. It is built on OS-level features and enforces two boundaries: filesystem isolation (limit Claude to specific directories so a prompt-injected agent cannot modify sensitive system files) and network isolation (limit Claude to approved servers so it cannot leak data or download malware).
- Both boundaries are required together: without network isolation a compromised agent can exfiltrate files like SSH keys, and without filesystem isolation it can escape the sandbox and gain network access.
- Internal usage: sandboxing reduced permission prompts by 84% (no baseline or methodology given).
- The sandboxed bash tool uses the open-source sandbox runtime (github.com/anthropic-experimental/sandbox-runtime, a research preview), which lets you define which directories and network hosts a process may access without container overhead; it can sandbox arbitrary processes, agents, and MCP servers.
- Enforcement is via Linux bubblewrap and macOS Seatbelt at the OS level, and restrictions apply to any scripts, programs, or subprocesses spawned by a command.
- Filesystem policy: read and write to the current working directory is allowed, and modifying files outside it is blocked.
- Network policy: all internet access goes through a Unix domain socket connected to a proxy server running outside the sandbox. The proxy enforces domain restrictions and handles user confirmation for newly requested domains, and teams can customize it to enforce arbitrary outbound-traffic rules.
- Any attempt to reach something outside the sandbox triggers an immediate notification and the user decides whether to allow it. Both boundaries are configurable by path and by domain, and are enabled with `/sandbox` in Claude Code.
- The authors claim that even a successful prompt injection stays isolated within the boundaries; no independent evaluation is described.
- Claude Code on the web: each session runs in an isolated cloud sandbox with full access to its own server. Sensitive credentials (git credentials, signing keys) are kept outside the sandbox so compromised code cannot easily cause further harm.
- A custom git proxy handles all git interactions: inside the sandbox the git client authenticates to the proxy with a custom scoped credential, and the proxy verifies the credential and the git operation (e.g. that pushes only target the configured branch) before attaching the real authentication token and forwarding to GitHub.
- Developers building their own agents can reuse the open-sourced sandboxing code. The article does not cover notification text, how violations are reported back to Claude, settings keys, the default-allowed command list, or explicit limitations.

## Harness implications
- [component:osSandbox] Enforce the shell sandbox at the OS level so it covers every script and subprocess a command spawns.
  > restrictions apply to any scripts, programs, or subprocesses spawned by a command
- [component:osSandbox] Always pair filesystem isolation with network isolation, since either one alone can be bypassed.
  > Both boundaries are required together
- [component:osSandbox] Route all egress through a proxy outside the sandbox that enforces the domain allowlist.
  > all internet access goes through a Unix domain socket connected to a proxy server running outside the sandbox
- [component:osSandbox] Turn sandbox violations into immediate, specific notices that are shown apart from ordinary permission prompts.
  > Any attempt to reach something outside the sandbox triggers an immediate notification
- [component:osSandbox] Make both boundaries configurable per project by path and by domain.
  > Both boundaries are configurable by path and by domain
- [foundation:secretsOutside] Keep credentials outside the sandbox and let the harness attach them to privileged operations such as git push after checking the operation.
  > Sensitive credentials (git credentials, signing keys) are kept outside the sandbox
- [component:osSandbox] Use the same sandbox for MCP servers and subagents, not only for the shell tool.
  > it can sandbox arbitrary processes, agents, and MCP servers
- [component:osSandbox] Measure the drop in permission prompts, aiming for fewer and more meaningful prompts rather than none.
  > sandboxing reduced permission prompts by 84%
