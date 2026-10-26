Type every implication in the bundled lesson library so the harness can use all 30 lessons, not 5. This is a content task: no code changes except, if truly needed, to `docs/lesson-template.md`.

Context. A lesson in `lessons/<slug>.md` ends with a `## Harness implications` section of `- ` bullets. A typed bullet has the form

```markdown
- [kind:target] One-sentence claim.
  domains: web, cli        (optional)
  > a quote, verbatim, from this lesson's own ## Learnings section
```

`shared/implications.ts` derives three things from these bullets: each Harness card's lesson list (component and foundation targets), the "Lessons for this stage" block each phase's first message carries (stage targets, trusted ones only, at most 8 lines per stage), and the Ideas list (bullets with no target). A bullet with no `[kind:target]` prefix is treated as a gap idea, so today 25 of the 30 lessons contribute nothing to the Harness cards or the stage prompts. `npm run lessons:check` lists them: 195 bullets across 25 files. Five lessons are already typed and are the model to follow: `claude-code-best-practices`, `demystifying-evals-for-ai-agents`, `effective-harnesses-for-long-running-agents`, `harness-design-long-running-apps`, `writing-tools-for-agents`.

Valid kinds and targets (an unknown one is a lint error):

- `component:` planner, contracts, evaluator, scouts, featureList, progressFile, projectMemory, gitCommits, compaction, contextEditing, resetWithHandoff, taskBudget, thinkTool, toolSearch, toolExamples, skills, selfVerification, narration, actionClassifier, osSandbox, stageLessons
- `foundation:` eventLog, fileHandoff, ownedLoop, toolHygiene, secretsOutside, untrustedOutput, effectiveConfig, cacheAsSignal, reliability, declarativeConfig, reviewIntent
- `stage:` plan, contract, build, evaluate, wrapup
- `skill:` verify-like-a-user, writing-a-contract
- `[gap]` for an idea nothing implements yet

The catalogue in `shared/components.ts` describes what each component and foundation does and which lessons it was mapped to before; read it before typing, and read `docs/audit/<slug>.md` for each lesson, which traces every learning to code with a status of implemented, partial or gap. Use the audit as the guide: a learning the audit marks implemented or partial targets the component or foundation the audit names; a learning it marks gap stays `[gap]`.

Rules for each bullet:

1. One claim, one target. If a bullet today makes two claims about two things, split it into two bullets.
2. The claim is one sentence in the lesson's own terms, written so it reads correctly inside a prompt on its own, without the lesson around it.
3. The quote must appear verbatim in that lesson's `## Learnings` section (copy, don't paraphrase; the lint checks it). Pick the shortest span that carries the evidence.
4. Use `stage:` only for advice a role should read at the start of that phase, phrased as an instruction the role can act on. Prefer it over `component:` when the lesson is about how to behave rather than what the harness should provide. Keep the stage set small: the block is capped at 8 lines per phase across the whole library, so only the strongest stage claims should carry that prefix.
5. Add `domains:` only when the claim applies to a kind of project (web, cli, golang, python) rather than to every run.
6. Keep existing `[gap]`-worthy ideas: do not force a target onto a claim nothing implements. The Ideas list is where those belong.
7. Keep frontmatter `components:`/`foundations:` lists as they are; they remain as implicit implications and the lint only warns when a bullet duplicates one.
8. Do not change the Learnings, takeaway, tags or any other section, and do not reorder bullets you don't split (implication ids are `slug#n` by position).

Work lesson by lesson, running `npm run lessons:check` after each file. Commit each lesson, or small groups, with a message naming the lessons typed.

Done means: `npm run lessons:check` reports 0 errors and no "have no [kind:target] prefix" warnings; every component and foundation in the catalogue is targeted by at least one implication (the lint warns on any that is not); `npm test` passes (`server/src/lessons.test.ts`, `stageLessons.test.ts` and `docs.test.ts` cover the library); and a final note lists, per phase, how many trusted stage implications now exist, so it is visible where the 8-line cap is doing the trimming.
