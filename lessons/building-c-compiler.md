---
title: Building a C compiler with parallel Claudes
date: 2026-02-05
url: https://www.anthropic.com/engineering/building-c-compiler
tags: multi-agent, long-running, coding-agents, harness
takeaway: Sixteen Claude agents built a roughly 100,000-line Rust C compiler with no orchestrator, coordinated only through git lock files and a never-ending session loop. The harness did the heavy lifting: near-perfect tests, terse grep-friendly output, fast sampled test modes, oracle-based task decomposition and specialist roles. Passing autonomous tests is not the same as done, so human verification still matters.
---

## Learnings
- Experiment: 16 Claude agents working in parallel on a shared codebase, without human intervention, wrote a from-scratch C compiler in Rust (about 100,000 lines) that builds Linux 6.9 on x86, ARM, and RISC-V.
- Scale: about 2,000 Claude Code sessions over two weeks, about 2 billion input tokens and 140 million output tokens, for a total cost just under $20,000.
- Results: roughly 99% pass rate on most compiler test suites including the GCC torture tests; compiles QEMU, FFmpeg, SQLite, PostgreSQL, Redis; compiles and runs Doom. Clean-room: no internet access during development, depends only on the Rust standard library. The spec required an optimizing, GCC-compatible compiler with an SSA IR and multiple backends.
- Limitations: no 16-bit x86 code generator (real-mode output exceeded 60 KB vs Linux's 32 KB limit, so GCC is called for that phase; ARM and RISC-V compile fully alone); no native assembler or linker (GCC's used); some projects fail to build; generated code is slower than GCC with optimizations off; Rust quality is reasonable but well below expert; late in the project new fixes often broke existing functionality (near the limits of Opus's ability).
- Infinite-loop harness: standard scaffolds like Claude Code stop and wait for input, so a `while true` bash loop runs `claude --dangerously-skip-permissions -p "$(cat AGENT_PROMPT.md)"`, logging each session to `agent_logs/agent_<short-git-hash>.log`. Run it in a container. Claude once ran `pkill -9 bash` and killed its own loop.
- The agent prompt (`AGENT_PROMPT.md`) states the problem, breaks it into small pieces, tracks what the agent is working on, decides what is next, and keeps going "until it's perfect."
- Parallel setup: a bare git repo is the upstream, mounted at `/upstream` in each agent's Docker container; each agent clones to `/workspace` and pushes back when done. A fresh container and session start for every iteration.
- Task locking via git: to claim work, an agent writes a lock file in `current_tasks/` named for the task (e.g. `parse_if_statement.txt`). If two agents claim the same task, git's push conflict forces the second to pick another. After work: pull, merge upstream, push, remove the lock. Merge conflicts are frequent but Claude resolves them.
- No orchestrator, no goal management, and no inter-agent communication beyond git. Agents pick the "next most obvious" problem and keep a running doc of failed approaches and remaining tasks.
- Lesson 1, write extremely high-quality tests: the verifier must be nearly perfect or Claude solves the wrong problem. The team sourced compiler test suites, wrote verifiers and build scripts for open-source packages, and added tests for every observed failure mode. Late in the project regressions were common, so a stricter CI pipeline was added so new commits cannot break existing code.
- Lesson 2, put yourself in Claude's shoes: each agent starts in a fresh container with zero context, so the harness required extensive READMEs and progress files, updated frequently.
- Context window pollution is a model limitation to design around: print only a few lines, log details to files, put `ERROR` and the reason on the same line so `grep` finds it, and precompute summary statistics.
- Time blindness is the other limitation: print progress infrequently and provide a `--fast` test option running a random 1% or 10% sample, deterministic per agent but random across VMs so all files are covered and every agent can still catch regressions.
- Lesson 3, make parallelism easy: independent failing tests parallelize trivially. After hitting 99% on suites, each agent took a different open-source project (SQLite, Redis, libjpeg, MQuickJS, Lua).
- The Linux kernel was one giant task where all agents hit the same bug and overwrote each other. The fix was to use GCC as a known-good oracle: the harness randomly compiled most kernel files with GCC and the rest with Claude's compiler, and if the kernel booted the bug was not in Claude's subset, otherwise narrow further. Agents could then fix different bugs in different files, and delta debugging afterwards found pairs of files that failed together but worked alone.
- Lesson 4, multiple agent roles: separate agents coalesced duplicate code, improved compiler performance, improved generated-code efficiency, critiqued the design from a Rust developer's perspective and restructured, and maintained documentation.
- The project was a capability benchmark across the Claude 4 series: Opus 4 barely produced a functional compiler, Opus 4.5 passed large test suites but could not compile real large projects, and Opus 4.6 reached the above.
- Risk note from the author (ex-pentester): passing autonomous tests can be mistaken for completed work, and deploying software without human verification is concerning.

## Harness implications
- Provide a run-forever mode with session-per-iteration restarts, each session logged under a stable identifier (commit hash) so the trajectory is reconstructible.
- Treat git as the coordination substrate: lock files in a `current_tasks/`-style directory, pull/merge/push at session end, and surface lock ownership and merge conflicts in the UI.
- Build verification quality into the harness: a CI gate that rejects regressions, plus a deterministic fast-sample test mode so agents get cheap signal without burning time or context.
- Protect the context window by design: tools should emit terse, grep-friendly output (one-line errors), write details to files, and precompute summaries; the UI can show the full log while the agent sees the digest.
- Design for time blindness: avoid chatty progress output; expose elapsed time and budget explicitly as harness state rather than expecting the model to infer it.
- Keep README and progress files as mandatory, frequently-updated artifacts since every session starts cold.
- Decompose big tasks into independently attackable shards (oracle-based bisection, per-project targets) so parallel agents do not pile onto the same bug; the harness can offer an oracle/bisection helper. Support role specialization (dedup, perf, quality critic, docs) as distinct prompt profiles on the same harness.
- Guard against the agent killing its own harness (`pkill -9 bash`) by running the supervisor outside the agent's process tree or container.
- Make "tests pass" distinct from "done" in the UI; require a human verification step before anything is treated as shippable.
