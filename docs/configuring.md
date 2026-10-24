# Configuring Reins

This page covers how to save a run setup as a **preset**, what every harness **component** does on each engine, and how to add your own **lessons** and **skills**. Everything a user adds lives under `$REINS_HOME` (default `~/.reins`), never in the repo.

## Presets

A preset is a *partial* run config: engine, component switches, roles, pauses, context policy, guardrails and limits. It never contains `task`, `workspace`, `id` or `createdAt`; those always come from the run you are starting. Applying a preset merges it over the defaults, so a preset only changes what it names.

The New run dialog has a preset picker, **Save as preset…**, **Reset to defaults** and an *N changes from defaults* summary. The Harness section lists every preset with a **Start a run with <preset>** button. The run records the preset's name in its `config.json` (`"preset": "Minimal"`, or `"Minimal (modified)"` if you changed something after picking it).

### Built-in presets

| Preset | What it is |
|---|---|
| **Full** | Today's defaults (`defaultRunConfig()`). Applying it gives zero changes from defaults. |
| **Minimal** | "Start simple" (building-effective-agents): only `narration`, `actionClassifier` and `osSandbox` on. No planner, contract or evaluator, no pauses, no fix rounds. |
| **Careful** | Full, plus every pause on and guardrail mode `ask`. The action classifier is off because it is only used in `auto` mode. |
| **Claude Code** | Sets the Claude Code engine and turns off the components that only the direct engine honours (see *Engines* below), so nothing is silently ignored. |

Built-ins are defined in `shared/config.ts` and cannot be overwritten or deleted.

### Presets generated from lessons: Web app, CLI / tool, and your domains

Lessons can carry preset effects in their frontmatter (see [lesson-template.md](lesson-template.md)):

```
domains: web, cli
enables: evaluator, selfVerification
disables: narration
guidance: Give yourself a check you can run and show its output as evidence.
```

Reins composes a preset per domain (`shared/presets.ts`, `composePreset`), recomputed from the current library on every `GET /api/presets`, so adding a lesson file changes it without a restart:

- **Recipes.** `web` is **Web app** and `cli` is **CLI / tool**. Both start from the Full config with no engine and add verify-like-a-user guidance: Web app starts the dev server with a timeout and makes real HTTP requests; CLI / tool runs `--help`, one happy path, and bad input expecting a non-zero exit code and a message on stderr. A domain only lessons name (e.g. `domains: games`) gets a generic preset named after it ("Games") on the same Full base.
- **Composition order.** Matching lessons apply oldest `date` first, then by slug, so a newer lesson wins a conflict. Guidance lines are the recipe's plus one per lesson, deduplicated, at most 10.
- **Basis.** Each generated preset lists the lessons it was built from with what each contributed (`on: …; off: …; guidance`), and a lesson that lost a conflict says `overridden by <slug>`. New run and Harness show this as "Built from N lessons", each linking to the lesson; a lesson with domains shows "Shapes presets: …".
- **Engine adaptation.** Generated presets are *adaptive*: on Claude Code they switch off the components only Direct API honours (Scouts, Compaction, Context editing, Task budget, Tool search, Tool examples) instead of being unavailable, and New run says "adapted for Claude Code: N switches off (…)".
- In Lessons, select lessons (or use the current filter) and click **Build a preset from these** to open New run prefilled with the composition; **Save as preset…** stores it with its `lessons` list.

Generated names (Web app, CLI / tool, …) are reserved: `POST /api/presets` with one returns 400.

### Which presets fit which engine (compatibility)

`presetCompatibility(preset, engine)` decides, for built-in, generated and your presets alike:

- A preset that names an engine fits only that engine (Claude Code fits only claude-code). Picking it in New run switches the engine and says so.
- A preset that turns on a component the engine ignores does not fit, unless it is adaptive. So **Full** and **Careful** need Direct API: on Claude Code they are shown disabled with the reason. **Minimal** fits both.
- Switching the engine away from a preset that does not fit clears it to Custom with a one-line notice. "My default" is applied only if it fits the engine New run opens on; otherwise New run starts from the defaults and says why.
- `GET /api/presets` returns a `compatibility` entry per engine for every preset, and Harness opens *Start a run with…* on an engine that fits (or disables it with the reason).

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

## The config checker

`checkRunConfig(config)` in `shared/config.ts` reports settings that will be ignored or contradict each other:

- a component that is on but ignored by the chosen engine;
- an unmet `requires` (e.g. `resetWithHandoff` without `progressFile`);
- settings that do nothing: fix rounds or the after-evaluation pause with the evaluator off, the contract pause with contracts off, the plan pause with the planner off, the commit pause with commits off;
- suspicious numbers: `context.resetAtTokens <= context.compactAtTokens`, `budgetUsd < 1`, `maxTurnsPerPhase < 5`.

New run shows the warnings live, and the Harness section shows them for the selected run. At run start the orchestrator writes each one to the run log as a `note` with level `warn`, before the first phase. Warnings never block a run.

## Components

Every switch with what it does, what the harness does instead when it is off, which engines honour it, and what it depends on. *Direct API* is the `anthropic` engine, where Reins owns the Messages API loop. *Claude Code* is the `claude-code` engine, which runs each role through the local Claude Code login. On Claude Code, the switches that only the direct loop implements (tool search, tool examples, compaction, context editing, task budgets, scouts) are ignored, and the checker says so.

| id | Component | What it does | When off | Engines | Requires | Default |
|---|---|---|---|---|---|---|
| `planner` | Planner | Expand a short task into a spec before building. | The task text itself is written to .reins/spec.md as the spec; there is no plan phase and no planner-made feature list. | Direct API, Claude Code | – | on |
| `contracts` | Sprint contracts | Builder and evaluator agree what 'done' means and how to verify it before any code is written. | No contract phase: the run is held to one generic criterion ("the task as described is complete and verified by running the result"). | Direct API, Claude Code | – | on |
| `evaluator` | Skeptical evaluator | A separate agent checks every contract criterion against the live result. | No evaluate phase and no contract review: nobody but the builder checks the result, and fix rounds never run. | Direct API, Claude Code | – | on |
| `scouts` | Scout subagents | The builder can delegate a research question to a short-lived read-only subagent that returns a summary, not its transcript. | delegate_scout is not offered, so the builder explores the codebase in its own context window. | Direct API | – | on |
| `featureList` | Feature list (features.json) | A structured feature list the agent must not delete from, only mark done. | Features are still tracked in the run log, but .reins/features.json is not written, so the next session cannot re-read what remains. | Direct API, Claude Code | – | on |
| `progressFile` | Progress notes (progress.md) | Structured note-taking outside the context window, re-read at the start of every session. | update_progress notes are not appended to .reins/progress.md, so the next session (and a reset) starts without them. | Direct API, Claude Code | – | on |
| `projectMemory` | Project memory (CLAUDE.md) | The workspace's CLAUDE.md (and AGENTS.md) is handed to every role as the project's own instructions. | CLAUDE.md and AGENTS.md are not handed to the roles; they rediscover the project's conventions by reading the repo. | Direct API, Claude Code | – | on |
| `gitCommits` | Commit per phase | Leave the repo in a clean, committed state at each phase boundary. | No commit at phase boundaries, the git_commit tool is hidden and the agents are told not to commit. | Direct API, Claude Code | – | on |
| `compaction` | Compaction | Summarize old history in place when the prompt grows past a threshold. | Old history is never summarised; a long phase grows until it hits the turn cap or the context limit. | Direct API | – | on |
| `contextEditing` | Clear stale tool results | Drop old tool outputs from the prompt without summarizing them. | Old tool results stay in the prompt verbatim for the rest of the phase. | Direct API | – | on |
| `resetWithHandoff` | Reset with handoff | Start a fresh conversation from a written handoff when the context is nearly full. | The builder keeps one conversation across fix rounds, however long it gets. | Direct API, Claude Code | `progressFile` (The handoff is read from .reins/progress.md, which is only written when progress notes are on.) | off |
| `taskBudget` | Task budget (time awareness) | Tell the model how many tokens a phase may spend so it paces itself instead of being cut off. | The model is not told its token budget; it is only stopped by the turn cap and the dollar budget. | Direct API | – | on |
| `thinkTool` | Think tool | A no-op tool that gives the model a place to stop and reason between tool calls. | The think tool is not offered and the prompt does not ask for explicit pauses between tool calls. | Direct API, Claude Code | – | on |
| `toolSearch` | Tool search | Keep rarely-used tools out of the prompt and load them on demand. | Every tool schema, including rarely used ones (git_*, http_fetch, lessons), is loaded into every prompt. | Direct API | – | on |
| `toolExamples` | Tool use examples | Ship one realistic example call with the trickier tools so parameters are filled correctly. | Tools ship with their schema only, without an example call. | Direct API | – | on |
| `skills` | Skills (SKILL.md) | Only skill names and one-line descriptions sit in the prompt; the body is read when a task calls for it. | No skills index in the prompt and no read_skill tool; installed skills are ignored. | Direct API, Claude Code | – | on |
| `selfVerification` | Self-verification | The builder must run the contract's verification steps before calling finish. | The builder is not told to run the verification steps before finish; only the evaluator (if on) checks them. | Direct API, Claude Code | – | on |
| `narration` | Plain-language narration | Every tool call is rendered as a sentence a person can skim. | Nothing changes yet: tool calls are always narrated in the log. The switch is recorded with the run for ablation tracking. | Direct API, Claude Code | – | on |
| `actionClassifier` | Action classifier | Classify each risky shell command against the task instead of asking about everything. | In auto mode, ambiguous shell commands ask you instead of being settled by the classifier. | Direct API, Claude Code | – | on |
| `osSandbox` | OS sandbox (macOS) | Run shell commands under a Seatbelt profile: writes only inside the workspace and temp, no network unless allowed. | Shell commands run without the Seatbelt profile; only the policy rules stand between the agent and the machine. | Direct API, Claude Code | – | on |

The table is generated from `COMPONENTS` in `shared/components.ts`. A test (`server/src/docs.test.ts`) fails if any component id is missing here.

## Lessons: bundled and your own

- **Bundled**: `lessons/*.md` in the repo.
- **Yours**: `$REINS_HOME/lessons/*.md`. A file with the same name (slug) as a bundled lesson **overrides** it; every other file is added. Your lessons get a *user* badge in the Lessons view and `"source": "user"` in `GET /api/lessons`.

Start from [docs/lesson-template.md](lesson-template.md). It is the format the parser expects: frontmatter with `title`, `date` (YYYY-MM-DD) and `takeaway`, optional `url`, `tags` and `components:` / `foundations:` lists of ids, then `## Learnings` and `## Harness implications` sections of `- ` bullets. Frontmatter `components:` are merged with the mapping in `shared/components.ts`, so a new lesson can say what it informs. CRLF line endings and quoted values are fine.

**No restart needed.** Each read of the library takes a cheap stat signature of both directories: the list of `.md` files with their sizes and mtimes, plus whether the directory exists at all. If the signature changed since the last parse, the library is re-parsed. So adding, editing or deleting a file, or creating `$REINS_HOME/lessons` after the server started, shows up on the next request. The Lessons view also has a **Reload** button that simply refetches.

**Safety.** Only regular `.md` files whose names are valid slugs are read. A symlink that resolves outside the lessons directory is not read and is reported as a problem. `GET /api/lessons/:slug` returns 404 for anything that is not a plain slug.

**Problems are never silent.** A file with no frontmatter, a missing title/date/takeaway, a bad date, an unknown component or foundation id, or an empty section is listed in the Lessons view's problems panel and in `GET /api/lessons/problems`. Catalogue slugs in `shared/components.ts` that point at no lesson file are listed too.

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
