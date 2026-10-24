---
title: Effective harnesses for long-running agents
date: 2025-11-26
url: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
tags: long-running, harness, coding-agents, reliability
takeaway: Agents working in discrete sessions have no memory of earlier ones, so the harness must carry the handoff in files and git, not in context. Use an initializer session that writes a structured feature list, an init script and a progress log, then have each coding session follow a fixed startup routine, do one feature, verify it end to end, and leave a clean committed state.
source: post
standing: bundled
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
- [component:featureList] Keep a structured feature list where the agent may only flip status, never delete entries.
  > Coding agents may only flip `passes`.
- [component:progressFile] Each session starts with no memory of the last, so progress must live outside the context window.
  > each new session has no memory of the previous one
- [component:planner] An initializer session expands the prompt into a feature list before any coding session.
  > the initializer agent in the first session expands the prompt into a feature list
- [component:gitCommits] Commit with descriptive messages so bad changes can be reverted and working states recovered.
  > git lets bad changes be reverted and working states recovered
- [component:selfVerification] Agents mark features done after unit tests alone unless told to verify end to end.
  > Claude tended to mark features complete after unit tests or `curl` checks without end-to-end verification.
- [stage:build] Start every session the same way: read git log, the progress notes and the feature list, then pick the highest-priority unfinished feature.
  > read git logs and progress files; read the feature list and pick the highest-priority unfinished feature
- [stage:build] Work on one feature at a time and leave a clean state: commit, progress note, status update.
  > One feature per session was critical to curbing one-shotting.
- [stage:build] Before marking a feature done, verify it end to end as a human user would, not only with unit tests or curl.
  > test "as a human user would"
- [stage:build] Run a basic end-to-end smoke test before starting new work.
  > Before new work, the agent runs a basic end-to-end smoke test
- [stage:plan] Write a feature list that covers every feature the prompt implies.
  > set up an initial environment that covers every feature the prompt implies
- [stage:wrapup] Existing progress is not completion: check the feature list before declaring the job done.
  > a fresh agent sees existing progress and declares the whole job done.
- [skill:verify-like-a-user] Verification tools have blind spots; record them so a human checks those features.
  > Claude cannot see browser-native alert modals through Puppeteer MCP
- [gap] Make the environment bootstrap script a harness-known artifact that runs automatically with its output logged.
  > The `init.sh` written by the initializer starts the dev server
- [gap] Allow role-specialised sessions (testing, QA, cleanup) with a pluggable session prompt.
  > it is unclear whether one general-purpose coding agent or specialized agents (testing, QA, code cleanup) do better
