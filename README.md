# Reins

An agent harness you can see. Reins runs a **planner**, a **builder** and a **skeptical evaluator** against a repository on your machine, built from the lessons in the [Anthropic engineering blog](https://www.anthropic.com/engineering). Every piece of scaffolding is a switch, every decision is narrated in plain language, and every lesson that justifies a feature is one click away.

```bash
npm install
npm run dev            # http://localhost:5190
```

Press **d** to watch a recorded run with no API key. Add an `ANTHROPIC_API_KEY` (environment or Settings) for live runs.

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

Each component states the assumption about the model it encodes. When a new model ships, the Harness tab lets you launch the same task with one component flipped, so you can find out what is still load-bearing.

- **Roles**: planner, sprint contracts, skeptical evaluator.
- **Memory**: `features.json`, `progress.md`, commit per phase.
- **Context**: server-side compaction, clearing of stale tool results, reset with a written handoff. The Context tab shows the prompt as a fuel gauge, its estimated composition, and the thresholds at which each intervention fires.
- **Tools**: a think tool, tool search (rarely used tools stay out of the prompt until found), self-verification, plain-language narration. Tool results are capped and tell the model how to narrow them.
- **Safety**: hard denies, workspace confinement, a read-only allowlist that runs in parallel, an action classifier that sees only your task and the proposed command, and a sniff for instruction-shaped text in tool output.

## The UI

- **Stage**: the run as a narrated feed. Approvals appear inline; contracts are editable before you approve. Type a note at the bottom to steer the agent; it is delivered before the next model call as an operator-authority message.
- **Transcript**: every event, filterable, with a scrubber that rewinds the whole UI to any point in the run.
- **Contract**: criteria × evaluation rounds, with the evaluator's evidence.
- **Context**: gauge and history per role, cache hit rate, interventions.
- **Guardrails**: every gating decision, who made it and why.
- **Files**: changed files and diffs against the commit the run started from.
- **Harness**: the effective configuration and the switches.
- **Lessons**: 30 distilled posts, each linked to the components it informs. The agents can read them too.

Keyboard: `n` new run, `d` demo, `space` pause/resume, `1`-`8` tabs, `?` help.

## Layout

```
shared/     types, component catalogue, narration (imported by both sides)
server/     Hono + WebSocket API, the agent loop, orchestrator, tools, guardrails, JSONL run store
web/        React + Vite + Tailwind UI
lessons/    the distilled blog posts (markdown with frontmatter)
demo/       a scripted recording used by the replay engine
```

Runs are stored under `~/.reins/runs/<id>/events.jsonl` as an append-only event log; the UI is a pure fold over that log, which is what makes replay and scrubbing cheap.

## Scripts

```bash
npm run dev          # server (5191) + web (5190) with reload
npm run typecheck    # both sides
npm test             # guardrail rules
npm run record-demo  # regenerate demo/sample-run.jsonl
npm run build && npm start   # single-process production serve
```

## Status

The live engine targets the current Claude Messages API (adaptive thinking, effort, prompt caching, server-side compaction, context editing, tool search, refusal fallbacks) and degrades gracefully when a beta is rejected. It has not yet been exercised against a real API key from this checkout; the recorded demo is synthetic and labelled as such in the UI.
