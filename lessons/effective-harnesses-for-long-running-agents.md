---
title: Effective harnesses for long-running agents
date: 2025-11-26
url: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
tags: long-running, harness, coding-agents, reliability
takeaway: Agents working in discrete sessions have no memory of earlier ones, so the harness must carry the handoff in files and git, not in context. Use an initializer session that writes a structured feature list, an init script and a progress log, then have each coding session follow a fixed startup routine, do one feature, verify it end to end, and leave a clean committed state.
---

## Learnings
- Core problem: agents work in discrete sessions and each new session has no memory of the previous one, like engineers working shifts with no handoff. Complex projects do not fit in one context window, so the harness must bridge sessions.
- Compaction (Claude Agent SDK) is not sufficient on its own: it "doesn't always pass perfectly clear instructions to the next agent." Even Opus 4.5 in a loop across context windows, prompted only with "build a clone of claude.ai", fell short of a production-quality app.
- Failure pattern 1, one-shotting: the agent tries to build everything at once, runs out of context mid-implementation, and leaves a half-built, undocumented feature. The next session has to guess what happened and spend tokens restoring basic functionality.
- Failure pattern 2, premature victory: later in the project, a fresh agent sees existing progress and declares the whole job done.
- The fix has two parts: set up an initial environment that covers every feature the prompt implies, and make each session produce incremental progress and leave the environment in a clean state. "Clean state" means code appropriate for merging to a main branch: no major bugs, orderly, well documented, so a new developer can start a feature without cleaning up unrelated mess.
- Two-agent structure (the two "agents" differ only in their initial user prompt; system prompt, tools, and harness are identical): the initializer agent in the first session expands the prompt into a feature list, writes `init.sh` to run the environment, creates `claude-progress.txt` as an action log, and makes an initial git commit.
- The coding agent in every later session makes incremental progress on one feature, then leaves structured updates (commit plus progress note).
- The feature list (`feature_list.json`) for the claude.ai clone had over 200 features, all initially `"passes": false`. Each entry has `category` (e.g. `"functional"`), `description` (e.g. "New chat button creates a fresh conversation"), `steps` (an array of end-to-end test steps: navigate, click, verify conversation created, check welcome state, verify sidebar entry), and `passes` (boolean).
- Coding agents may only flip `passes`. Prompt wording: "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality." JSON was chosen over Markdown because models are less likely to inappropriately change or overwrite JSON.
- One feature per session was critical to curbing one-shotting. Agents commit to git with descriptive messages and write progress summaries; git lets bad changes be reverted and working states recovered, and avoids wasted effort guessing at prior state.
- Testing failure mode: Claude tended to mark features complete after unit tests or `curl` checks without end-to-end verification. Explicitly prompting it to use browser automation and test "as a human user would" (Puppeteer MCP server) greatly improved results.
- Vision and browser-automation limits: Claude cannot see browser-native alert modals through Puppeteer MCP, so features depending on alerts were buggier.
- Fixed startup routine for each coding agent: run `pwd` (edits limited to that directory); read git logs and progress files; read the feature list and pick the highest-priority unfinished feature.
- The `init.sh` written by the initializer starts the dev server so later agents do not spend tokens discovering how to run the app. Before new work, the agent runs a basic end-to-end smoke test (start server, open chat, send message, receive response) to catch broken state so bugs are fixed before features are added.
- A typical session opening: `pwd`; read `claude-progress.txt` and `feature_list.json`; `git log --oneline -20`; start the server via `init.sh`; verify basic features; begin a new feature.
- Failure modes and solutions: claims victory too early (initializer writes a structured JSON feature list from the spec; coding agent reads it and chooses one feature); leaves bugs or undocumented progress (initial git repo and progress notes; agent reads them, tests basics, commits and updates progress at session end).
- More failure modes: marks features done prematurely (agent self-verifies and marks passing only after careful testing); wastes time figuring out how to run the app (initializer writes `init.sh`; agent starts by reading it).
- Future work: it is unclear whether one general-purpose coding agent or specialized agents (testing, QA, code cleanup) do better. The demo is full-stack web apps, and the lessons may generalize to scientific research or financial modeling. A related post is "Harness design for long-running application development" (Mar 24, 2026).

## Harness implications
- Separate a one-time initialization phase (spec expansion, environment script, progress log, initial commit) from a repeatable work phase; the harness should run them as distinct prompts over the same tools.
- Maintain a machine-readable, append-only-ish task ledger (JSON) where the agent may only change status fields; the harness should enforce that structurally (schema validation, diff checks), not just by prompt.
- Force a fixed session preamble: cwd, git log, progress file, task ledger, environment bootstrap, smoke test. The UI should surface this "orientation" phase distinctly from feature work.
- Enforce one unit of work per session and a clean-state exit: commit, progress note, status update. The harness can refuse to end a session (or flag it) when the tree is dirty or the progress file is unchanged.
- Treat compaction as lossy; durable handoff lives in files and git, not in the context window. The UI should show the progress file and recent commits as first-class panels.
- Require end-to-end verification tooling (browser automation, screenshots) before a task can be marked done, and record what verification was performed; show verification evidence in the UI. Know the blind spots of the verifier (e.g. native alert modals invisible to Puppeteer) and represent them in task metadata so humans can review those features manually.
- Make the environment bootstrap (`init.sh`) a harness-known artifact that is run automatically, with its output logged, rather than rediscovered each session.
- Keep the door open for role-specialized sessions (test, QA, cleanup) by making the session prompt pluggable while the harness stays constant.
