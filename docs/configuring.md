# Configuring Reins

This page covers how a run is composed from **Effort**, **Supervision** and domains, how to save a run setup as a **preset**, what every harness **component** does on each engine, and how to add your own **lessons** and **skills**. Everything a user adds lives under `$REINS_HOME` (default `~/.reins`), never in the repo.

## Effort

A run is composed from two dials and any number of domains: `{ effort, supervision, domains }`. **Effort** (`low`, `medium`, `high`, `max`) decides what the harness spends on the task: the effort-tier components and the budgets. It does not change the roles' models or their reasoning effort; Customize keeps that control as **Reasoning effort**. The default is `medium`.

<!-- generated:effort -->
| | low | medium | high | max |
|---|---|---|---|---|
| `planner` | off | on | on | on |
| `contracts` | off | off | on | on |
| `evaluator` | off | on | on | on (re-runs every criterion) |
| `scouts` | off | off | on | on |
| `taskBudget` | off | on | on | on |
| `thinkTool` | off | off | off | on |
| `maxFixRounds` | 0 | 1 | 2 | 3 |
| `maxTurnsPerPhase` | 30 | 60 | 90 | 120 |
| `budgetUsd` | $3 | $10 | $20 | $40 |
<!-- /generated:effort -->

At `max` the evaluate phase tells the evaluator to run every contract criterion's verification step afresh in that round, without reusing earlier rounds' evidence or the builder's summary, and a `report_evaluation` that omits a criterion id is refused with a message naming the missing ids, so the evaluator reports again. Below `max` an incomplete report is accepted as before.

## Supervision

**Supervision** (`unattended`, `check-in`, `ask-every-write`) decides when the run pauses for you and the guardrail mode. The default is `check-in`.

<!-- generated:supervision -->
| id | Label | Chip | Pauses | Guardrail mode | Action classifier |
|---|---|---|---|---|---|
| `unattended` | Unattended | Unattended | none | `auto` | on |
| `check-in` | Check in at gates | Check in | `afterPlan`, `afterContract`, `afterEvaluation` | `auto` | on |
| `ask-every-write` | Ask before every write | Ask every write | `afterPlan`, `afterContract`, `beforeCommit`, `afterEvaluation` | `ask` | off |
<!-- /generated:supervision -->

A pause turns on only if its gate exists at the chosen effort: no plan pause without the planner, no contract pause without contracts, no evaluation pause without the evaluator. So every effort × supervision × engine combination composes to a config with zero config-checker warnings (a test checks all 24). `trust` mode stays reachable only through Customize.

## Tiers

Every component has a `tier` in `shared/components.ts` that says who decides whether it is on:

- **Always on** (`always`): the practices the lessons back and the audit marks implemented (feature list, progress notes, project memory, commit per phase, compaction, context editing, reset with handoff, self-verification, narration, stage lessons, tool search, tool examples, skills, OS sandbox). On at every effort and not shown in New run. A saved preset or a `POST /api/runs` body that sends `false` for one is a 400 naming the component. `lessons:check` warns when an always-tier component is targeted by no bundled or reviewed implication.
- **Set by Effort** (`effort`): planner, contracts, evaluator, scouts, task budget, think tool. The Effort dial sets them; Customize may still override them.
- **Follows settings** (`engine`): the action classifier, derived from Supervision (off in `ask` mode, where nothing reaches it).

Engine support is separate from the tier: a component the run's engine does not honour (its `engines` field) is resolved **off** on that engine and recorded off in the run config. That is not "turning it off": there is no 400, no ablation and no checker warning.

## Ablation

The only way to turn an always-tier component off is an experiment. The Harness card's **Experiment: run without Compaction** opens New run with an experiment banner, and `POST /api/runs` accepts `ablated: ComponentId[]`: every id must be always-tier (otherwise a 400 naming it), each listed id is set off, and `ablated` is recorded on the config. A `components: { compaction: false }` is accepted only when `compaction` is also in `ablated`. The title chip ends with "Experiment: without Compaction". On effort-tier cards the button flips the component as an override; engine-tier cards have none. `POST /api/runs/:id/repeat` reuses the recorded config verbatim, `ablated` included, so a trial set has identical configs.

## Migration

The retired care profiles and the old Claude Code preset are read, never written back:

| legacy id or name | composition |
|---|---|
| `full`, "Full" | `medium` + `check-in` |
| `minimal`, "Minimal" | `low` + `unattended` |
| `careful`, "Careful" | `high` + `ask-every-write` |
| "Claude Code" | `medium` + `check-in`, engine `claude-code` |
| "Web app", "CLI / tool", "Go", "Python" | `medium` + `check-in` + that domain |

- **Old runs** keep their `config.json` untouched and their old chip text ("Careful · Go · CLI"). Run again maps them onto the dials; always-tier offs they recorded are kept on, with the notice "kept on; use Harness › Experiment to run without". Repeat reuses them as recorded.
- **Saved presets** in `$REINS_HOME/presets.json` are read as `{ effort, supervision, domains }` plus their overrides. A legacy entry gets an inferred composition (mode `ask` → ask-every-write; all pauses off → unattended; otherwise check-in; contracts on → high; planner and evaluator off → low; otherwise medium), and its always-tier `false` values are dropped. A `default` naming "Full", "Careful", "Minimal", "Claude Code" or a generated preset resolves to the migrated composition (`GET /api/presets` returns it as `defaultComposition`).
- **A legacy body** `POST /api/runs {"presets": ["careful","golang","cli"]}` is accepted, migrated and recorded as `effort`, `supervision` and `domains`.

## Presets

A saved preset is a *partial* run config: effort, supervision, domains, engine, component overrides, roles, pauses, context policy, guardrails and limits. It never contains `task`, `workspace`, `id` or `createdAt`, and it may not turn an always-tier component off. Applying a preset merges it over the defaults, so a preset only changes what it names. New run has **Save as preset…** and an *N changes* summary in Customize; the run records the preset's name (`"mine"`, or `"mine (modified)"`).

### Presets generated from lessons: Web app, CLI / tool, and your domains

Lessons can carry preset effects in their frontmatter (see [lesson-template.md](lesson-template.md)):

```
domains: web, cli
enables: evaluator, selfVerification
disables: narration
guidance: Give yourself a check you can run and show its output as evidence.
```

Reins composes a preset per domain (`shared/presets.ts`, `composePreset`), recomputed from the current library on every `GET /api/presets`, so adding a lesson file changes it without a restart:

- **Recipes.** `web` is **Web app**, `cli` is **CLI / tool**, `golang` is **Go** and `python` is **Python**. Both start from the Full config with no engine and add verify-like-a-user guidance: Web app starts the dev server with a timeout and makes real HTTP requests; CLI / tool runs `--help`, one happy path, and bad input expecting a non-zero exit code and a message on stderr. A domain only lessons name (e.g. `domains: games`) gets a generic preset named after it ("Games") on the same Full base.
- **Composition order.** Matching lessons apply oldest `date` first, then by slug, so a newer lesson wins a conflict. Guidance lines are the recipe's plus one per lesson, deduplicated, at most 10.
- **Basis.** Each generated preset lists the lessons it was built from with what each contributed (`on: …; off: …; guidance`), and a lesson that lost a conflict says `overridden by <slug>`. New run and Harness show this as "Built from N lessons", each linking to the lesson; a lesson with domains shows "Shapes presets: …".
- **Engine adaptation.** Generated presets are *adaptive*: on Claude Code they switch off the components only Direct API honours (Scouts, Compaction, Context editing, Task budget, Tool search, Tool examples) instead of being unavailable, and New run says "adapted for Claude Code: N switches off (…)".
- In Lessons, select lessons (or use the current filter) and click **Build a preset from these** to open New run prefilled with the composition; **Save as preset…** stores it with its `lessons` list.

Generated names (Web app, CLI / tool, …) are reserved: `POST /api/presets` with one returns 400.

### Which presets fit which engine

`presetCompatibility(preset, engine)`: a preset that names an engine fits only that engine (picking it in New run switches the engine and says so). Every other preset fits both engines; the switches the engine does not honour follow the engine and are listed as dropped. `GET /api/presets` returns a `compatibility` entry per engine for every preset.

### Run guidance

`guidance` is an optional list of one-line instructions in a run config or preset. `systemPromptFor()` appends them to every role's system prompt under "Guidance for this run", for both engines. Non-string entries are dropped, newlines are collapsed, each line is capped at 200 characters and the list at 10 lines. New run shows the lines before start; edit, remove or add them there.

### Your presets: `$REINS_HOME/presets.json`

The file is written by the server; you can also edit it by hand.

```json
{
  "default": "mine",
  "presets": [
    {
      "name": "mine",
      "description": "Builder and evaluator, no planner",
      "config": { "components": { "planner": false }, "pauses": { "afterContract": false }, "budgetUsd": 5 },
      "createdAt": "2026-10-24T12:00:00.000Z"
    }
  ]
}
```

- `default` is the preset New run starts from (a built-in or one of yours), or `null`. Unless New run has a prefill or an unsaved draft, it opens with this preset applied.
- Names are labels, never paths. They are cleaned to letters, digits, space, `_ . -` with no leading dots, so `../../evil` becomes `evil`.
- Only known keys and known component ids are kept. Unknown ones and the forbidden `task`, `workspace`, `id`, `createdAt` are dropped, and the API response lists what was dropped. A value of the wrong type (e.g. `"budgetUsd": "lots"`) is rejected with a 400 and a one-line message.

API:

| Route | Does |
|---|---|
| `GET /api/presets` | `{ presets: [{ name, description, builtIn, config, isDefault }], default, file }` |
| `POST /api/presets` | Body `{ name, description?, config, default? }`. Creates or replaces a user preset, returns `201 { preset, dropped, default }`. |
| `POST /api/presets/default` | Body `{ name }` marks any preset as the default; `{ name: null }` clears it. |
| `DELETE /api/presets/:name` | Removes a user preset. Built-ins answer 400. |

### Composition: Effort + Supervision + domains

`composeRun({ effort, supervision, domains })` in `shared/presets.ts` starts from the dials and layers the **domain presets** (`web`, `cli`, `golang`, `python`, and every domain a trusted lesson or implication names) in the order picked. The run records `effort`, `supervision` and `domains`, and its title chip reads "High · Check in · Go · CLI". An unknown effort, supervision or domain is a 400. Explicit fields in the `POST /api/runs` body still win.

Domain layering can only raise effort and tighten supervision:

- `enables:`/`disables:` may touch only effort-tier and engine-tier components; an always-tier id is ignored (and `lessons:check` warns).
- A domain may not switch off an effort-tier component the dial turned on, and may not reduce fix rounds, turns or budget.
- A domain may not switch off a pause, move the guardrail mode toward `trust` (ask < auto < trust), set `allowNetwork: true`, add `allowPatterns`, or turn the classifier on in `ask` mode.
- Each refused effect is recorded in the basis with its reason; it is not applied and does not throw.
- **Guidance**: the union of the recipes' lines and the lessons' `guidance:` lines, deduplicated and capped at 10. **Stage lessons**: trusted stage implications for the picked domains plus untagged ones, at most 8 per stage. **Roles and context**: later wins per key. **Engine**: never set by a domain.

**Effort recommendations.** A lesson may carry `- [effort:high] domains: web Claim.` New run shows the recommendations that match the picked domains with the claim, the lesson link and a **Use High** button; they are never applied silently, and the composed config ignores them.

New run shows the Effort and Supervision controls, each with a one-line meaning, and the **domain chips**. The workspace check suggests domains with a reason: `go.mod` suggests `golang`, a `package.json` that depends on vite, next or react suggests `web`, a `cmd/` directory or a `bin` field in `package.json` suggests `cli`, and `pyproject.toml` suggests `python`.

### Lessons for this stage

With the `stageLessons` component on (the default, on both engines), each phase's first message gets a block "Lessons for this stage": the stage implications (`[stage:plan]`, `[stage:breakdown]`, `[stage:contract]`, `[stage:build]`, `[stage:evaluate]`, `[stage:wrapup]`) that are bundled or reviewed, reviewed before bundled, newest lesson first, deduplicated, at most 8 lines. The lines are resolved when the run is created and recorded on the run config as `stageLessons`, so a replay or a later look at the run shows exactly what the agents saw.

## Work packages

With `workPackages` on (always, on both engines) and a planner, the plan is followed by a **breakdown** stage: the planner reads the spec and feature list and calls `propose_breakdown` with work packages, each one pull request a reviewer can read in one sitting. The harness validates the proposal (`shared/packages.ts`) and refuses it with the reasons when a feature is in no package or in two, a package estimates more than `PACKAGE_MAX_LINES` (400) changed lines, a dependency points at a later package, or a package has no features; the planner then proposes again. The agreed breakdown is written to `.reins/packages.json`, recorded as a `breakdown.agreed` event, and shown on the plan approval card (the `afterPlan` pause now waits until after the breakdown).

Contract, build and evaluate then run once per package, in order. Each phase's first message carries a "Work package" section (its id, title, features and rationale), and its `phase.started` and `phase.finished` events carry `package: { id, title, index, total }`. The builder starts each package from a fresh conversation (progress notes carry over) and is told to build only that package's features; the per-package commit is `reins: build P1 — <title>`. A package that still fails evaluation after the fix rounds stops the run before the next package starts, naming the package. With the planner off there is no feature list to slice, so the run is one package and the phases carry no `package` field; the same holds for an ablation that runs without `workPackages`.

## The config checker

`checkRunConfig(config)` in `shared/config.ts` reports settings that will be ignored or contradict each other:

- an unmet `requires` (e.g. `resetWithHandoff` without `progressFile`);
- settings that do nothing: fix rounds or the after-evaluation pause with the evaluator off, the contract pause with contracts off, the plan pause with the planner off, the commit pause with commits off;
- suspicious numbers: `context.resetAtTokens <= context.compactAtTokens`, `budgetUsd < 1`, `maxTurnsPerPhase < 5`.

New run shows the warnings live, and the Harness section shows them for the selected run. At run start the orchestrator writes each one to the run log as a `note` with level `warn`, before the first phase. Warnings never block a run.

## The turn budget: nudge, forced report, synthesised report

Every phase has a turn cap (`maxTurnsPerPhase`, set by Effort: 30, 60, 90 or 120). Agents are blind to it: an evaluator with many criteria will spend its whole budget starting servers and driving browsers, be cut off mid-check, and never call `report_evaluation`. A round with no report has nothing for the builder to fix, so the harness makes sure a phase that must end with a structured tool (`report_evaluation`, `finish`, `propose_contract`, `review_contract`) always hands something on. The same three steps run on both engines (`server/src/engine/turnBudget.ts`):

1. **Turns-remaining nudge.** Once `TURNS_REMAINING_NUDGE_AT` (5) turns or fewer remain, every model call is preceded by an operator-authority message: how many turns are left, call the terminal tool now with what has been verified, and report anything unchecked as *unverified* (`pass: false, unverified: true`) rather than failed. It repeats on each remaining turn. On the Direct API engine it is a mid-conversation system message; on Claude Code it is the `PostToolBatch` hook's additional context, delivered right before the next request. Each nudge is a warn note on the Stage ("The evaluator has 3 turns left…").
2. **Forced report at the cap.** If the cap is reached without the terminal tool (or the model ends its turn with plain text twice after being asked to finish), the harness makes one more call whose only tool is the terminal tool, saying the budget is exhausted and it must report from what it has. On the Direct API engine that call offers only that tool with `tool_choice: any`; on Claude Code it is a one-turn `resume` of the same session with every built-in tool off and only that tool on the Reins MCP server. A report obtained this way is marked **forced** on the Contract tab and in the `evaluation.result` event (`origin: "forced"`), and a warn note says how many criteria were verified.
3. **Synthesised report.** If even the forced call does not report, the harness writes the evaluation itself: every criterion unverified, the evaluator's last text as the summary, `origin: "synthesised"` on the event and a *synthesised report* badge on the Contract tab. The builder's next fix round is therefore never empty: it lists each criterion as `UNVERIFIED` and asks the builder to run those verification steps itself.

Unverified criteria show as **?** on the Contract tab. A hard criterion that is unverified still fails the round (nothing was observed to pass), but the fix-round brief says it was not checked rather than that it is broken. When the last round's report was forced or synthesised, the run's failure message says so: *the evaluator ran out of turns (60) before reporting; 1 of 13 criteria were verified*, and suggests raising `maxTurnsPerPhase` for the evaluate phase or agreeing a contract with fewer criteria. The default turn cap is unchanged.

## Components

Every switch with its tier, what it does, what the harness does instead when it is off, which engines honour it, and what it depends on. *Direct API* is the `anthropic` engine, where Reins owns the Messages API loop. *Claude Code* is the `claude-code` engine, which runs each role through the local Claude Code login. On Claude Code, the switches that only the direct loop implements follow the engine: they are recorded off.

<!-- generated:components -->
| id | Component | Tier | What it does | When off | Engines | Requires | Default |
|---|---|---|---|---|---|---|---|
| `planner` | Planner | Set by Effort | Expand a short task into a spec before building. | The task text itself is written to .reins/spec.md as the spec; there is no plan phase and no planner-made feature list. | Direct API, Claude Code | – | on |
| `workPackages` | Work packages | Always on | After the plan, the planner slices the feature list into pull-request-sized packages; contract, build and evaluate run once per package, in order. | No breakdown phase: the feature list is built as one package, so one contract covers the whole run and a pull request would be as big as the task. (With the planner off there is no feature list to slice, so the run is one package as well.) | Direct API, Claude Code | – | on |
| `contracts` | Sprint contracts | Set by Effort | Builder and evaluator agree what 'done' means and how to verify it before any code is written. | No contract phase: the run is held to one generic criterion ("the task as described is complete and verified by running the result"). | Direct API, Claude Code | – | on |
| `evaluator` | Skeptical evaluator | Set by Effort | A separate agent checks every contract criterion against the live result. | No evaluate phase and no contract review: nobody but the builder checks the result, and fix rounds never run. | Direct API, Claude Code | – | on |
| `scouts` | Scout subagents | Set by Effort | The builder can delegate a research question to a short-lived read-only subagent that returns a summary, not its transcript. | delegate_scout is not offered, so the builder explores the codebase in its own context window. | Direct API | – | on |
| `featureList` | Feature list (features.json) | Always on | A structured feature list the agent must not delete from, only mark done. | Features are still tracked in the run log, but .reins/features.json is not written, so the next session cannot re-read what remains. | Direct API, Claude Code | – | on |
| `progressFile` | Progress notes (progress.md) | Always on | Structured note-taking outside the context window, re-read at the start of every session. | update_progress notes are not appended to .reins/progress.md, so the next session (and a reset) starts without them. | Direct API, Claude Code | – | on |
| `projectMemory` | Project memory (CLAUDE.md) | Always on | The workspace's CLAUDE.md (and AGENTS.md) is handed to every role as the project's own instructions. | CLAUDE.md and AGENTS.md are not handed to the roles; they rediscover the project's conventions by reading the repo. | Direct API, Claude Code | – | on |
| `gitCommits` | Commit per phase | Always on | Leave the repo in a clean, committed state at each phase boundary. | No commit at phase boundaries, the git_commit tool is hidden and the agents are told not to commit. | Direct API, Claude Code | – | on |
| `compaction` | Compaction | Always on | Summarize old history in place when the prompt grows past a threshold. | Old history is never summarised; a long phase grows until it hits the turn cap or the context limit. | Direct API | – | on |
| `contextEditing` | Clear stale tool results | Always on | Drop old tool outputs from the prompt without summarizing them. | Old tool results stay in the prompt verbatim for the rest of the phase. | Direct API | – | on |
| `resetWithHandoff` | Reset with handoff | Always on | Start a fresh conversation from a written handoff when the context is nearly full. | The builder keeps one conversation across fix rounds, however long it gets. | Direct API, Claude Code | `progressFile` (The handoff is read from .reins/progress.md, which is only written when progress notes are on.) | on |
| `taskBudget` | Task budget (time awareness) | Set by Effort | Tell the model how many tokens a phase may spend so it paces itself instead of being cut off. | The model is not told its token budget; it is only stopped by the turn cap and the dollar budget. | Direct API | – | on |
| `thinkTool` | Think tool | Set by Effort | A no-op tool that gives the model a place to stop and reason between tool calls. | The think tool is not offered and the prompt does not ask for explicit pauses between tool calls. | Direct API, Claude Code | – | off |
| `toolSearch` | Tool search | Always on | Keep rarely-used tools out of the prompt and load them on demand. | Every tool schema, including rarely used ones (git_*, lessons), is loaded into every prompt. | Direct API | – | on |
| `toolExamples` | Tool use examples | Always on | Ship one realistic example call with the trickier tools so parameters are filled correctly. | Tools ship with their schema only, without an example call. | Direct API | – | on |
| `skills` | Skills (SKILL.md) | Always on | Only skill names and one-line descriptions sit in the prompt; the body is read when a task calls for it. | No skills index in the prompt and no read_skill tool; installed skills are ignored. | Direct API, Claude Code | – | on |
| `selfVerification` | Self-verification | Always on | The builder must run the contract's verification steps before calling finish. | The builder is not told to run the verification steps before finish; only the evaluator (if on) checks them. | Direct API, Claude Code | – | on |
| `narration` | Plain-language narration | Always on | Every tool call is rendered as a sentence a person can skim. | Nothing changes yet: tool calls are always narrated in the log. The switch is recorded with the run for ablation tracking. | Direct API, Claude Code | – | on |
| `actionClassifier` | Action classifier | Follows settings | Classify each risky shell command against the task instead of asking about everything. | In auto mode, ambiguous shell commands ask you instead of being settled by the classifier. | Direct API, Claude Code | – | on |
| `osSandbox` | OS sandbox (macOS) | Always on | Run shell commands under a Seatbelt profile: writes only inside the workspace and temp, no network unless allowed. | Shell commands run without the Seatbelt profile; only the policy rules stand between the agent and the machine. | Direct API, Claude Code | – | on |
| `stageLessons` | Lessons for this stage | Always on | Each phase's first message carries a short block of reviewed stage implications from the lesson library (at most 8 lines). | No "Lessons for this stage" block: the roles get only their fixed prompts and any run guidance. | Direct API, Claude Code | – | on |
<!-- /generated:components -->

The tables on this page are generated from `shared/components.ts` by `npm run docs:tables`; `server/src/docs.test.ts` fails when a generated block differs from its renderer.

## Lessons: bundled and your own

- **Bundled**: `lessons/*.md` in the repo.
- **Yours**: `$REINS_HOME/lessons/*.md`. A file with the same name (slug) as a bundled lesson **overrides** it; every other file is added. Your lessons get a *user* badge in the Lessons view and `"source": "user"` in `GET /api/lessons`.

Start from [docs/lesson-template.md](lesson-template.md). It is the format the parser expects: frontmatter with `title`, `date` (YYYY-MM-DD) and `takeaway`, optional `url`, `tags` and `components:` / `foundations:` lists of ids, then `## Learnings` and `## Harness implications` sections of `- ` bullets. Frontmatter `components:` are merged with the mapping in `shared/components.ts`, so a new lesson can say what it informs. CRLF line endings and quoted values are fine.

**No restart needed.** Each read of the library takes a cheap stat signature of both directories: the list of `.md` files with their sizes and mtimes, plus whether the directory exists at all. If the signature changed since the last parse, the library is re-parsed. So adding, editing or deleting a file, or creating `$REINS_HOME/lessons` after the server started, shows up on the next request. The Lessons view also has a **Reload** button that simply refetches.

**Safety.** Only regular `.md` files whose names are valid slugs are read. A symlink that resolves outside the lessons directory is not read and is reported as a problem. `GET /api/lessons/:slug` returns 404 for anything that is not a plain slug.

**Problems are never silent.** A file with no frontmatter, a missing title/date/takeaway, a bad date, an unknown component or foundation id, or an empty section is listed in the Lessons view's problems panel and in `GET /api/lessons/problems`. Catalogue slugs in `shared/components.ts` that point at no lesson file are listed too.

### Typed implications

Every bullet under `## Harness implications` is one implication: the atomic link between a lesson and the harness. Syntax:

```markdown
- [stage:evaluate] One-sentence claim.
  domains: web, cli
  > A quote from the source, verbatim.
```

- The prefix is `[kind:target]`. Kinds: `component` (a component id from the table above), `stage` (`plan`, `contract`, `build`, `evaluate`, `wrapup`), `skill` (a skill name; the SKILL.md links back with a `lessons:` frontmatter line), `foundation` (a foundation id), and `gap` (no target: an idea the harness does not implement, shown on the Ideas list of the Harness section).
- The indented `domains:` line tags the implication; a lesson-level `domains:` tags every implication in the file.
- The indented `> quote` line is the evidence. For bundled lessons the quote must appear in the lesson's Learnings; for intake drafts it must appear verbatim in the fetched source.
- A bullet without a prefix is still valid: it is a gap, and `npm run lessons:check` warns about it. An unknown kind or target is an error.
- Frontmatter `components:` and `foundations:` lists still work; each entry counts as an implicit implication.
- Each component's and foundation's lesson list on the Harness section is derived from these implications; `lessons:check` warns about a component no implication targets.

### Provenance and standing

Lessons carry `source:` (`post`, `article`, `paper`, `postmortem`, `note`), `date:` and `standing:`. Bundled lessons are always `bundled`; your lessons default to `unreviewed`. Only `bundled` and `reviewed` implications enter stage prompt blocks and presets; unreviewed ones appear only on the Ideas list. Set the standing on the Lessons section, or with `POST /api/lessons/:slug/standing` and a body `{"standing":"reviewed"}`.

### Lesson intake

On the Lessons section, "Add a lesson" starts an **intake job** from a URL or pasted text. Intake is a separate job type, not a run: it does not appear in the Runs list or trial sets, but its events stream to the Stage like a run. Files live in `$REINS_HOME/lessons/<slug>/` (`source.md`, `draft.md`, `events.jsonl`, `job.json`).

1. The **librarian** role reads the source (for a URL, the harness fetches it with `http_fetch`; network is allowed for this job only), distils it into the lesson format with typed implications that each cite a quote, and ends with the `propose_lesson` tool. A quote that is not found verbatim in the source is rejected and the librarian must fix it.
2. A lesson **approval card** on the Stage shows the draft: each implication with its kind, target, claim, quote and domains. Edit a claim, target or domains, drop an implication (and keep it again), and pick the standing (`unreviewed` or `reviewed`). Adopt sends only the kept implications.
3. Approval adopts the lesson: it is written to `$REINS_HOME/lessons/<slug>.md` with a `hash:` line. Its quotes come from the job's `source.md`, so `lessons:check` checks them against that file as well as the Learnings.

**Intake jobs list.** The Lessons section lists every intake job with its status (distilling, needs your review, adopted, rejected, cancelled, failed, interrupted). *Review* or *Open* shows the job on the Stage, and the URL (`?run=intake-<slug>`) reopens it after a reload. *Cancel* stops a live job, and the Lessons link in the sidebar counts the drafts waiting for review. While a lesson is open, a notice links to the waiting draft. If the server restarts while a draft waits for approval, the approval card comes back from `draft.json`; a job whose librarian was cut off is marked *interrupted*, and its source can be taken in again.

A source whose content hash (or URL) matches a lesson in the library is refused with "This source matches <slug>; it is already in the library." A source that matches an intake job still in progress is refused with a message naming that job, and the form offers to open it; cancel the job to start over. A later **checker** role can be added at the hook `IntakeOrchestrator.check()` in `server/src/intake/intake.ts`: it runs between the proposal and the approval card and may annotate or reject implications.

### `npm run lessons:check`

Lints the bundled library, `$REINS_HOME/lessons` and the catalogue mapping, prints each problem with its file, and exits 1 if there is any error. It honours `REINS_HOME`:

```sh
npm run lessons:check                      # bundled + ~/.reins/lessons
REINS_HOME=/tmp/my-home npm run lessons:check
```

The agent tools see the same merged library: `list_lessons` (optional `query`, `tag` and `component` filters, one `slug: title — short takeaway` line per lesson) and `read_lesson(slug)`.

## Skills

A skill is a folder with a `SKILL.md` (frontmatter `name` and `description`, then the body). Only the name and description go into the prompt; a role reads the body with `read_skill` when it needs it. Skills are layered, and later layers override earlier ones by name:

1. bundled: `skills/` in the repo;
2. yours: `$REINS_HOME/skills/<name>/SKILL.md`;
3. the workspace: `<workspace>/.reins/skills/<name>/SKILL.md`, then `<workspace>/.claude/skills/` for names not already taken.

The Harness section's **Skills** list (from `GET /api/skills?workspace=<dir>`) shows what a run in that workspace would get, with each skill's source and directory. Without a `workspace` it uses the server's default workspace. A folder that does not exist simply contributes no workspace skills.
