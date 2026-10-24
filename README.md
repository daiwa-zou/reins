# Reins

An agent harness you can see. Reins runs a **planner**, a **builder** and a **skeptical evaluator** against a repository on your machine, built from the lessons in the [Anthropic engineering blog](https://www.anthropic.com/engineering). Every piece of scaffolding is a switch, every decision is narrated in plain language, and every lesson that justifies a feature is one click away.

```bash
npm install
npm run dev            # http://localhost:5190
```

Press **d** to watch a recorded run. For live runs pick an engine in the New run dialog:

| Engine | Needs | What Reins owns |
|---|---|---|
| **Direct API** | `ANTHROPIC_API_KEY` (environment or Settings) | The whole loop: prompt caching, compaction, context editing, tool search, task budgets, tool examples, every switch below. |
| **Claude Code** | A logged-in `claude` CLI (no API key) | Planner/contract/builder/evaluator pipeline, guardrails (`canUseTool`), structured end-of-phase tools (in-process MCP), the event log. Claude Code keeps its own tools and context management. |
| **Recorded demo** | nothing | A synthetic recording replayed through the same UI, approvals included. |

## What it does

A run moves through five phases. Roles never share a context window; they hand work to each other through files in the workspace's `.reins/` folder.

| Phase | Who | What | Lesson |
|---|---|---|---|
| Plan | Planner | Expands a short task into `.reins/spec.md` and a feature list the builder may only mark done, never delete. | Effective harnesses for long-running agents |
| Contract | Builder, then Evaluator, then **you** | A definition of done: 4-12 criteria, each with an exact verification step. You edit and approve it inline. | Harness design for long-running application development |
| Build | Builder | One feature at a time, session preamble first (progress notes, contract, baseline test run), self-verification before `finish`, commit per phase. | Effective harnesses; Claude Code best practices |
| Evaluate | Evaluator | Re-runs every verification step itself and reports pass/fail with evidence. Hard failures send the builder back for a fix round. | Harness design; Demystifying evals |
| Wrap up | Harness | Progress notes appended so the next session starts informed. | Effective context engineering |

## The parts of the harness

Each component states the assumption about the model it encodes, what the harness does instead when it is off, which engines honour it and what it depends on. When a new model ships, the Harness section lets you launch the same task with one component flipped, so you can find out what is still load-bearing. Save a setup as a **preset** (built-ins: Full, Minimal, Careful, Claude Code), and a config checker warns, without blocking, about switches the engine ignores, unmet dependencies and settings that do nothing. See **[docs/configuring.md](docs/configuring.md)** for presets and `presets.json`, the per-component table, your own lessons and skills, and `npm run lessons:check`.

- **Roles**: planner, sprint contracts, skeptical evaluator, scout subagents (a read-only subagent answers a codebase question and returns a summary, never its transcript).
- **Memory**: `features.json`, `progress.md`, the workspace's own `CLAUDE.md`/`AGENTS.md`, commit per phase.
- **Context**: server-side compaction, clearing of stale tool results, reset with a written handoff, a per-phase task budget the model can see. The Context tab shows the prompt as a fuel gauge, its estimated composition, and the thresholds at which each intervention fires.
- **Tools**: a think tool, tool search (rarely used tools stay out of the prompt until found), tool use examples, skills (`SKILL.md` folders with only the index in the prompt), self-verification, plain-language narration. Tool results are capped and tell the model how to narrow them.
- **Safety**: hard denies, workspace confinement, a read-only allowlist that runs in parallel, an action classifier that sees only your task and the proposed command, a macOS Seatbelt sandbox for shell commands (writes only in the workspace and temp, no network unless allowed), credentials stripped from the agent's environment, and a sniff for instruction-shaped text in tool output.

Decisions that are not switches (the append-only log, file handoff, owning the loop, capped tool output, secrets outside the sandbox, recorded effective config, cache hit rate as a signal, reliability over single runs, one declarative config, review intent not lines) are listed as **foundations** on the Harness tab, each with the lessons behind it. Every one of the 30 lessons informs at least one component or foundation.

## The UI

- **Stage**: the run as a narrated feed. Approvals appear inline; contracts are editable before you approve. Type a note at the bottom to steer the agent; it is delivered before the next model call as an operator-authority message.
- **Transcript**: every event, filterable, with a scrubber that rewinds the whole UI to any point in the run.
- **Contract**: criteria × evaluation rounds, with the evaluator's evidence.
- **Context**: gauge and history per role, cache hit rate, interventions.
- **Guardrails**: every gating decision, who made it and why.
- **Files**: changed files and diffs against the commit the run started from.
- **Harness**: every component with what it does, when off, engines and requires, linked to its lessons. With a run selected: its effective config, recorded preset, diff from defaults and checker warnings, plus *run with/without →*. With none: the presets with *Start a run with…*. Also lists the installed skills for the workspace.
  Presets are gated by engine (Full and Careful need Direct API) and include ones generated from lessons, Web app and CLI / tool, each showing the lessons it was built from.
- **Lessons**: 30 distilled posts plus your own from `$REINS_HOME/lessons` (picked up without a restart; same slug overrides). Filter by component, tag or search; the open lesson is in the URL; *informs* badges jump to the Harness card; invalid files are listed with the reason. Start a new one from [docs/lesson-template.md](docs/lesson-template.md). The agents read the same library with `list_lessons` (query/tag/component filters) and `read_lesson`.
  Lessons with `domains:`/`enables:`/`disables:`/`guidance:` shape the generated presets; select lessons and *Build a preset from these* to start a run from them.
- **Reliability**: runs of the same task group into trial sets with pass^k and pass@k; "Run 3 more" queues identical trials one after another.

Keyboard: `n` new run, `d` demo, `space` pause/resume, `1`-`9` tabs, `?` help.

## Layout

```
shared/     types, component catalogue, narration (imported by both sides)
server/     Hono + WebSocket API, the agent loop, orchestrator, tools, guardrails, JSONL run store
web/        React + Vite + Tailwind UI
lessons/    the distilled blog posts (markdown with frontmatter; lint with npm run lessons:check)
docs/       configuring.md (presets, components, user lessons and skills), lesson-template.md, audit/
skills/     bundled SKILL.md folders (verify-like-a-user, writing-a-contract)
demo/       a scripted recording used by the replay engine
```

Runs are stored under `~/.reins/runs/<id>/events.jsonl` as an append-only event log; the UI is a pure fold over that log, which is what makes replay and scrubbing cheap.

## Scripts

```bash
npm run dev          # server (5191) + web (5190) with reload
npm run typecheck    # both sides
npm test             # guardrails, tool hygiene, sandbox probe, event fold, trial math, loop + orchestrator against a scripted API
npm run record-demo  # regenerate demo/sample-run.jsonl
npm run build && npm start   # single-process production serve
```

## Audit

`docs/audit/` holds an independent audit of the harness against each post: the post is re-fetched, the lesson file checked against it, and every learning traced to code (`path:line`), a component or a foundation, with honest statuses (implemented, partial, gap) and the smallest change that would close each gap. The Lessons tab shows the same table per lesson. The audit index is in [docs/audit/README.md](docs/audit/README.md): all thirty posts are covered (112 implemented, 148 partial, 46 gaps at the time of writing). Ten were audited independently with the post re-fetched; the other twenty are a self-audit marked as such, with an independent re-check queued.

## Status

- **Claude Code engine**: exercised end to end from this checkout with the local login and no `ANTHROPIC_API_KEY` (the SDK init message reports `apiKeySource: "none"`). Usage counts against the Claude subscription; the per-turn costs are the SDK's list-price estimates. Known quirk: the SDK's Bash tool runs in your login shell, so shell aliases apply (a `cat` alias that colourises output confused the agent once; it recovered with Read).
- **Direct API engine**: the loop is tested against a scripted stand-in for the Messages API (tool execution, parallel read-only calls, guardrail approvals and denials, operator notes as mid-conversation system messages, graceful fallback when a beta is rejected) and the orchestrator end to end over a temp git repo. It has not been run against the real API from this checkout because no key was available; every optional beta (compaction, context editing, task budgets, tool examples, refusal fallbacks) degrades to a warning instead of failing the run.
- **Sandbox**: the Seatbelt profile is probed in the test suite (writes outside the workspace and network are denied). With the Claude Code engine the SDK's own sandbox is enabled instead, with network off unless the run allows it.
- **Classifier**: single-stage and unmeasured here; the auto mode post reports 0.4% false positives and 17% misses for Anthropic's production classifier, so treat it as a filter, not a guarantee. Rules are the pre-filter; only flagged commands reach it.
- **CI**: `.github/workflows/ci.yml` runs type-checks, tests and the web build.
- The recorded demo is synthetic and labelled as such in the UI.
