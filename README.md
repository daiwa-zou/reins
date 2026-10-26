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

A run moves through eight phases; contract, tests, build, evaluate and publish repeat once per work package. Roles never share a context window; they hand work to each other through files in the workspace's `.reins/` folder.

| Phase | Who | What | Lesson |
|---|---|---|---|
| Plan | Planner | Expands a short task into `.reins/spec.md` and a feature list the builder may only mark done, never delete. | Effective harnesses for long-running agents |
| Breakdown | Planner | Slices the feature list into work packages, each one reviewable pull request (under 400 changed lines, every feature in exactly one package, ordered by dependency). The harness refuses a bad slicing with reasons; you review the packages with the plan. | Redesigning source control; Claude Code best practices |
| Contract | Builder, then Evaluator, then **you** | A definition of done: 4-12 criteria, each with an exact verification step. You edit and approve it inline. | Harness design for long-running application development |
| Tests | Test writer | Per package. Writes failing tests for every hard criterion through the real interface, explains each in `.reins/tests.md`; the harness runs the suite and refuses a plan that is already green. Passing the suite becomes a hard criterion. | Claude Code best practices; How Anthropic teams use Claude Code |
| Build | Builder | Per package. One feature at a time, session preamble first (progress notes, contract, baseline test run), self-verification before `finish`, commit per phase. | Effective harnesses; Claude Code best practices |
| Evaluate | Evaluator | Re-runs every verification step itself and reports pass/fail with evidence. Hard failures send the builder back for a fix round. | Harness design; Demystifying evals |
| Publish | Harness, then **you** | Per package. Pushes the package branch (cut from the freshly pulled base), opens a pull request whose body carries the contract, the evidence and the tests, answers review comments and failing checks with builder rounds that push and reply (up to three), waits for approval and green checks, asks before merging, merges and pulls the base so the next package starts from the merged tip. Skipped with a note when there is no remote or `gh` login. | Claude Code on the web; Redesigning source control |
| Wrap up | Harness | Progress notes appended so the next session starts informed. | Effective context engineering |

## The parts of the harness

Each component states the assumption about the model it encodes, what the harness does instead when it is off, which engines honour it and what it depends on (the table in [docs/configuring.md](docs/configuring.md)). You never pick components one by one: **Effort** decides what runs and **Supervision** decides when you are asked. When a new model ships, `POST /api/runs` with `ablated: [...]` launches the same task with an always-on component off, so you can find out what is still load-bearing. Save a setup as a **preset**, and a config checker warns, without blocking, about switches the engine ignores, unmet dependencies and settings that do nothing. See **[docs/configuring.md](docs/configuring.md)** for presets and `presets.json`, the per-component table, your own lessons and skills, and `npm run lessons:check`.

- **Roles**: planner, sprint contracts, skeptical evaluator, scout subagents (a read-only subagent answers a codebase question and returns a summary, never its transcript).
- **Memory**: `features.json`, `progress.md`, the workspace's own `CLAUDE.md`/`AGENTS.md`, commit per phase.
- **Context**: server-side compaction, clearing of stale tool results, reset with a written handoff, a per-phase task budget the model can see. The Context tab shows the prompt as a fuel gauge, its estimated composition, and the thresholds at which each intervention fires.
- **Tools**: a think tool, tool search (rarely used tools stay out of the prompt until found), tool use examples, skills (`SKILL.md` folders with only the index in the prompt), self-verification, plain-language narration. Tool results are capped and tell the model how to narrow them.
- **Safety**: hard denies, workspace confinement, a read-only allowlist that runs in parallel, an action classifier that sees only your task and the proposed command, a macOS Seatbelt sandbox for shell commands (writes only in the workspace and temp, no network unless allowed), credentials stripped from the agent's environment, and a sniff for instruction-shaped text in tool output.

Decisions that are not switches (the append-only log, file handoff, owning the loop, capped tool output, secrets outside the sandbox, recorded effective config, cache hit rate as a signal, reliability over single runs, one declarative config, review intent not lines) are listed as **foundations** in `shared/components.ts`, each linked from the lessons behind it (a lesson's *Used by* badges filter the library by component or foundation). Every one of the 30 lessons informs at least one component or foundation.

## The UI

- **Stage**: the run as a narrated feed. Approvals appear inline; contracts are editable before you approve. Type a note at the bottom to steer the agent; it is delivered before the next model call as an operator-authority message.
- **Transcript**: every event, filterable, with a scrubber that rewinds the whole UI to any point in the run.
- **Contract**: criteria × evaluation rounds, with the evaluator's evidence.
- **Context**: gauge and history per role, cache hit rate, interventions.
- **Guardrails**: every gating decision, who made it and why.
- **Files**: changed files and diffs against the commit the run started from.
- **Harness**: the page you start runs from. Each **Effort** level is a card saying in plain words which stages run (Plan, Breakdown, Contract, Tests, Build, Evaluate, Publish), what else is on, how many fix rounds, turns and dollars, with *Start a run*; each **Supervision** level says when it pauses; then the **domains** with the lessons that shape them, and your **saved presets** (make one the default, delete). The installed skills for the workspace sit at the bottom. No component cards and no effective-config dump: a run's recorded config is on its Details tab, and the per-component table is in [docs/configuring.md](docs/configuring.md).
  Presets are gated by engine (Full and Careful need Direct API) and include ones generated from lessons, Web app and CLI / tool, each showing the lessons it was built from.
  An **Ideas** list collects gap implications and unreviewed ones, each with its claim, its quote and a link to its lesson; unreviewed claims never reach stage prompts or presets. Foundation cards take their lessons from the implications that target them.
- **Lessons**: 30 distilled posts plus your own from `$REINS_HOME/lessons` (picked up without a restart; same slug overrides). Filter by component, tag or search; the open lesson is in the URL; *Used by* badges filter the library to the lessons behind a component or foundation; invalid files are listed with the reason. Start a new one from [docs/lesson-template.md](docs/lesson-template.md). The agents read the same library with `list_lessons` (query/tag/component filters) and `read_lesson`.
  Lessons with `domains:`/`enables:`/`disables:`/`guidance:` shape the generated presets; select lessons and *Build a preset from these* to start a run from them.
  Each open lesson shows its implications grouped by kind, with target links; your own lessons get a standing control (unreviewed / reviewed). *Add a lesson from a source…* starts an intake job: its events stream to the Stage, and a lesson **approval card** lists each implication (kind, target, claim, quote, domains) so you can edit or drop it and pick the standing before it is adopted into `$REINS_HOME/lessons`. An *Intake jobs* list on Lessons reopens a job on the Stage (also after a reload or a server restart) or cancels it.
- **New run**: two controls, **Effort** (Low, Medium, High, Max: what the harness spends) and **Supervision** (Unattended, Check in at gates, Ask before every write: when it asks you), each with a one-line meaning, plus **domain chips** (web, cli, golang, python and any domain a lesson names); the workspace check suggests domains with a reason (go.mod → golang). Always-on practices (progress notes, commits, compaction, self-verification, …) have no switch; an ablation experiment (`POST /api/runs` with `ablated`) is the only way to turn one off. A lesson can recommend an effort for a domain, shown with its reason and a *Use* button, never applied silently. The run title chip reads like "High · Check in · Go · CLI" (runs from before this change keep their old chip, e.g. "Careful · Go · CLI"). Saved presets still work from the select below. See [docs/configuring.md](docs/configuring.md) for the tables (generated by `npm run docs:tables`) and the migration of the retired care profiles.
- **Reliability**: runs of the same task group into trial sets with pass^k and pass@k; "Run 3 more" queues identical trials one after another.

Keyboard: `n` new run, `d` demo, `space` pause/resume, `r`/`t`/`h`/`l` sections, `1`-`4` run views, `?` help, `Esc` closes dialogs. Every shortcut is ignored while a text field or control has focus.

Requirements: Node 22 or newer and npm. The Seatbelt sandbox is macOS-only (`sandbox-exec`); on Linux the osSandbox component is reported unavailable and shell commands run unsandboxed under the guardrails. Environment variables: `REINS_HOME` (state directory, default `~/.reins`), `REINS_PORT` (API port, default 5191), `REINS_WORKSPACE` (default folder in the New run dialog), `REINS_SERVE_STATIC=1` (serve the built UI from the API process; `npm start` then opens on port 5191).

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

`docs/audit/` holds an independent audit of the harness against each of the 30 posts: every post was re-fetched, the lesson file checked against it, and every learning traced to code (`path:line`), a component or a foundation, with honest statuses (implemented, partial, gap) and the smallest change that would close each gap. The Lessons tab shows the same table per lesson. At the time of writing: 177 implemented, 209 partial, 61 gaps; the index with the open gaps is [docs/audit/README.md](docs/audit/README.md).

## Status

- **Claude Code engine**: exercised end to end from this checkout with the local login and no `ANTHROPIC_API_KEY` (the SDK init message reports `apiKeySource: "none"`). Usage counts against the Claude subscription; the per-turn costs are the SDK's list-price estimates. Known quirk: the SDK's Bash tool runs in your login shell, so shell aliases apply (a `cat` alias that colourises output confused the agent once; it recovered with Read).
- **Direct API engine**: by decision, verified against a scripted stand-in for the Messages API only (tool execution, parallel read-only calls, guardrail approvals and denials, operator notes as mid-conversation system messages, graceful fallback when a beta is rejected) plus the orchestrator end to end over a temp git repo. The Claude Code engine is the default live path; if you later add an `ANTHROPIC_API_KEY`, Settings › Test connection sends one request with the direct engine's exact shape and reports what the API accepted.
- **Sandbox**: the Seatbelt profile is probed in the test suite (writes outside the workspace and network are denied). With the Claude Code engine the SDK's own sandbox is enabled instead, with network off unless the run allows it.
- **Classifier**: single-stage and unmeasured here; the auto mode post reports 0.4% false positives and 17% misses for Anthropic's production classifier, so treat it as a filter, not a guarantee. Rules are the pre-filter; only flagged commands reach it.
- **CI**: `.github/workflows/ci.yml` runs type-checks, tests and the web build.
- The recorded demo is synthetic and labelled as such in the UI.
