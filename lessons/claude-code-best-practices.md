---
title: Claude Code: Best practices for agentic coding
date: 2025-04-18
url: https://www.anthropic.com/engineering/claude-code-best-practices
tags: coding-agents, context, harness, reliability, skills
takeaway: Everything in effective agentic coding follows from one constraint: the context window fills fast and quality degrades as it does. The biggest lever is giving the agent a check it can run, such as tests, stop hooks or a fresh-context reviewer, so the human is not the verification loop. Keep always-loaded instructions short, use hooks for what must always happen, and manage sessions like branches.
domains: web, cli
enables: evaluator
guidance: Give yourself a check you can run (tests, build exit code, linter) and show its output as evidence instead of asserting it passed.
source: post
standing: bundled
---

## Learnings
- Everything follows from one constraint: the context window fills fast and performance degrades as it fills. Every message, file read and command output lands in context, and one debugging session can burn tens of thousands of tokens. Track it with a status line and use `/context` to see what loaded. (The live page is a later rewrite at code.claude.com/docs/en/best-practices; items marked "original" below come from the original 2025 post and a secondary summary.)
- Verification is the key lever: give Claude a check it can run (tests, build exit code, linter, diff-against-fixture script, screenshot vs design). Without one, "looks done" is the only stop signal and the human becomes the verification loop.
- The gate strength ladder runs from in-prompt ("run tests and iterate"), to a session-wide `/goal` condition re-checked by a separate evaluator every turn, to a deterministic Stop hook that blocks turn end until a script passes (with a cap on consecutive blocks), to a verification subagent or dynamic workflow where a fresh model tries to refute the result so the worker is not its own grader.
- Demand evidence (test output, command plus result, screenshot) rather than assertions; evidence review is faster than re-running and works for unattended sessions. Address root causes and do not suppress errors.
- Explore, plan, code, commit: plan mode (`Shift+Tab` until "plan mode on", or `claude --permission-mode plan`) reads without writing, `Ctrl+G` opens the plan in an editor, and approval leads to implementation, commit and PR. Skip planning when the diff fits in one sentence; plan when unsure of approach, multi-file, or unfamiliar code.
- Original: ask Claude to read files, images and URLs explicitly without writing code yet, and use subagents to verify details early. Thinking budget keywords escalate: "think" < "think hard" < "think harder" < "ultrathink". Have Claude write the plan to a doc or GitHub issue so you can reset if the implementation is poor.
- Original workflows: write tests, commit, code, iterate, commit (avoid mock implementations, confirm tests fail before coding, do not modify tests, and use independent subagents to check for overfitting); write code, screenshot, iterate (Puppeteer MCP, iOS simulator MCP, or pasted images); safe YOLO mode (`--dangerously-skip-permissions` only inside a container without internet access, for lint fixes and boilerplate); codebase Q&A for onboarding; git/GitHub via `gh`; Jupyter notebooks in VS Code.
- Prompt specificity: scope the task, point to sources (git history), reference existing patterns (name an example file), and describe the symptom and what "fixed" looks like. Vague prompts are fine only when exploring. Rich content works too: `@file` references, pasted or dragged images, URLs (allowlist domains via `/permissions`), piped data like `cat error.log | claude -p "explain"`, and letting Claude fetch its own context.
- CLAUDE.md is read at every session start and `/init` generates a starter. Include bash commands Claude cannot guess, non-default style rules, test instructions, repo etiquette, project-specific architecture decisions, env quirks and gotchas. Exclude anything derivable from code, standard conventions, API docs (link instead), fast-changing info, file-by-file descriptions, and "write clean code".
- Keep CLAUDE.md short: for each line ask "would removing this cause mistakes?" Bloated files make Claude ignore instructions; if one rule keeps being skipped, mark that line alone "IMPORTANT". Treat it like code (review when things go wrong, prune, test by observing behaviour change, check it into git); `/doctor` proposes cuts and imports use `@path/to/file`.
- Original CLAUDE.md locations: repo root (checked in) or `CLAUDE.local.md` (gitignored), parent directories (monorepos), child directories (loaded on demand), and `~/.claude/CLAUDE.md` (all sessions). Press `#` to have Claude add an instruction.
- Use skills (`.claude/skills/<name>/SKILL.md`) for sometimes-relevant domain knowledge so it loads on demand, with `disable-model-invocation: true` for side-effectful manual workflows with `$ARGUMENTS`. The original equivalent was `.claude/commands/*.md` slash commands, e.g. `/project:fix-github-issue 1234`.
- Permissions: manual mode prompts for writes, Bash and MCP, and after the tenth approval you click through rather than review. Reduce prompts with allowlists (`/permissions`, settings.json, `--allowedTools "Edit,Bash(git commit *)"`) and sandboxing (OS-level filesystem/network isolation). Auto mode (default from v2.1.283) uses a separate classifier model that blocks only risky actions (scope escalation, unknown infrastructure, hostile-content-driven actions).
- CLI tools (`gh`, `aws`, `gcloud`, `sentry-cli`) are the most context-efficient integration, and Claude can learn unknown CLIs via `--help`. MCP servers cover Notion, Figma and databases (`claude mcp add`; original: `.mcp.json`, `--mcp-debug`).
- Hooks are deterministic where CLAUDE.md is advisory ("run eslint after every edit", "block writes to migrations"). Subagents in `.claude/agents/*.md` have their own tools and model and run in isolated context. Plugins bundle skills, hooks, subagents and MCP, and a code-intelligence plugin helps typed languages.
- Session management: `Esc` stops mid-action keeping context; `Esc Esc` or `/rewind` restores conversation and/or code to a checkpoint or summarizes from/up to a point; `/clear` between unrelated tasks. After two failed corrections, `/clear` and write a better prompt. Checkpoints snapshot files before each edit (only Claude's edits, not Bash), are saved with the conversation, and are not a git replacement.
- Persisted sessions use `--continue`, `--resume` and `/rename` (treat sessions like branches). Compaction auto-runs near the limit; `/compact <instructions>` and CLAUDE.md can say what must be preserved, and `/btw` asks side questions that never enter history. Original: use Markdown checklists or scratchpad files for large multi-step tasks.
- Let Claude interview you (AskUserQuestion) and write SPEC.md, then implement in a fresh session. Good specs name files and interfaces, state what is out of scope, and end with an end-to-end verification step.
- Automate and scale: non-interactive `claude -p` with `--output-format text|json|stream-json --verbose`, for CI, pre-commit and pipelines (`--no-session-persistence`); original headless uses included issue triage on GitHub events and subjective linting. Parallel sessions use git worktrees, cross-session messaging, desktop app, cloud, `claude agents`, and experimental agent teams.
- Use a Writer/Reviewer split across sessions, since a fresh context reviews without bias toward code it just wrote. Original fan-out: a script looping `claude -p` over a task list with `--allowedTools` and `--permission-mode dontAsk`; `/batch` splits across 5-30 subagents in worktrees (test on 2-3 files first). An adversarial reviewer subagent sees only the diff and criteria, and must be told to report only correctness and requirement gaps or it will over-engineer.
- Failure patterns: kitchen-sink session, correcting over and over, over-specified CLAUDE.md, trust-then-verify gap, and infinite unscoped exploration. Fixes: `/clear`, rewrite the prompt, prune or convert rules to hooks, always verify, scope or delegate to subagents.
- The agent's own check is not the last word: after it passes, the human runs `/verify` against the running app, and the bundled `/code-review` skill reviews the current diff for bugs in a fresh subagent before the work counts as done. In non-interactive `claude -p` auto-mode runs, repeated classifier blocks do not stop the run; auto mode falls back (documented thresholds), which differs from the terminate-on-escalation behaviour described in the auto mode post.

## Harness implications
- [component:selfVerification] Give the agent a check it can run, so "looks done" is never the only stop signal.
  > give Claude a check it can run (tests, build exit code, linter, diff-against-fixture script, screenshot vs design)
- [stage:build] Before finishing, run the project's own check (tests, build exit code, linter) and show its output as evidence instead of asserting it passed.
  > Demand evidence (test output, command plus result, screenshot) rather than assertions
- [stage:build] Fix root causes; never suppress an error or weaken a check to make it pass.
  > Address root causes and do not suppress errors.
- [component:evaluator] A fresh-context reviewer tries to refute the result, so the worker is not its own grader.
  > a fresh model tries to refute the result so the worker is not its own grader
- [stage:evaluate] Review the diff against the criteria from a fresh context and report only correctness and requirement gaps, not style.
  > An adversarial reviewer subagent sees only the diff and criteria, and must be told to report only correctness and requirement gaps or it will over-engineer.
- [component:testsFirst] Write the tests from the contract before any code, confirm they fail, and forbid the builder from changing them.
  > confirm tests fail before coding, do not modify tests
- [stage:tests] Test the behaviour through its real interface; a test that passes against a mock of the thing under test proves nothing.
  > avoid mock implementations
- [component:workPackages] Cut the plan into pull-request-sized packages, so each one goes through implementation, commit and its own PR.
  > approval leads to implementation, commit and PR
- [stage:breakdown] A package whose whole diff fits in one sentence needs no further slicing; one that spans several modules or an unfamiliar area does.
  > Skip planning when the diff fits in one sentence; plan when unsure of approach, multi-file, or unfamiliar code.
- [component:planner] Keep the plan as a durable artifact outside the conversation so the work can be reset and re-entered.
  > Have Claude write the plan to a doc or GitHub issue so you can reset if the implementation is poor.
- [stage:plan] Name the files and interfaces, say what is out of scope, and end the spec with an end-to-end verification step.
  > Good specs name files and interfaces, state what is out of scope, and end with an end-to-end verification step.
- [component:projectMemory] Keep the always-loaded project file short: every line must prevent a mistake.
  > Keep CLAUDE.md short: for each line ask "would removing this cause mistakes?"
- [component:skills] Put sometimes-relevant domain knowledge in skills that load on demand rather than in every prompt.
  > Use skills (`.claude/skills/<name>/SKILL.md`) for sometimes-relevant domain knowledge so it loads on demand
- [component:stageLessons] Give each stage only the few lessons that apply to it; a bloated always-loaded block gets ignored.
  > Bloated files make Claude ignore instructions
- [component:gitCommits] Commit real checkpoints: the session's own checkpoints only cover the agent's edits and are not a git replacement.
  > Checkpoints snapshot files before each edit (only Claude's edits, not Bash), are saved with the conversation, and are not a git replacement.
- [component:actionClassifier] Cut approval fatigue with a separate classifier that blocks only risky actions.
  > Auto mode (default from v2.1.283) uses a separate classifier model that blocks only risky actions
- [skill:verify-like-a-user] Without a runnable check the human becomes the verification loop; the verify-like-a-user skill packages one.
  > Without one, "looks done" is the only stop signal and the human becomes the verification loop.
- [gap] Offer restore-code, restore-conversation and summarize-from-here as first-class actions on any turn.
  > `Esc Esc` or `/rewind` restores conversation and/or code to a checkpoint or summarizes from/up to a point
- [gap] Add a batch primitive that shards one task over several worktree-isolated subagents.
  > `/batch` splits across 5-30 subagents in worktrees (test on 2-3 files first)
- [gap] Support deterministic hooks for actions that must always happen, since instructions are only advisory.
  > Hooks are deterministic where CLAUDE.md is advisory
