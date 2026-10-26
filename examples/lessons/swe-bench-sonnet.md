---
title: Raising the bar on SWE-bench Verified with Claude 3.5 Sonnet
date: 2025-01-06
url: https://www.anthropic.com/engineering/swe-bench-sonnet
tags: evals, tools, coding-agents, harness
takeaway: The SWE-bench Verified result came from a deliberately minimal scaffold, just a prompt, a Bash tool and a string-replacement Edit tool, with the model in control of sequencing. Most of the effort went into tool descriptions and error-proofing, such as requiring absolute paths. Benchmarks measure model plus scaffold together, and grading noise and hidden tests mean successful-looking runs need independent verification.
source: post
standing: bundled
components: toolExamples
foundations: toolHygiene
---

## Learnings
- SWE-bench gives the model a configured Python environment and a repo checkout from just before a real GitHub issue was fixed, and grades by the unit tests from the closing PR. SWE-bench Verified is a human-reviewed 500-problem subset confirmed solvable from the issue text.
- It measures the whole agent (model plus scaffolding), and scaffolding alone changes results significantly with the same model. The upgraded Claude 3.5 Sonnet scored 49% (previous SOTA 45%, old 3.5 Sonnet 33%, Claude 3 Opus 22%, all on the same scaffold).
- Scaffold philosophy is minimal and model-in-control: give the model as much control as possible and do not hardcode a workflow. Components are a prompt, a Bash tool, and an Edit tool, with sampling continuing until the model says it is done or exceeds the 200k context.
- The model moves between steps freely; logs label THOUGHT/ACTION/OBSERVATION but it is not constrained to that order (built on SWE-Agent). If token cost is no concern, explicitly encouraging long responses can help.
- Tools act as prompt engineering. The Bash tool takes one `command` parameter and its description carries the guidance: no XML escaping needed, no internet, apt/pip mirror available, persistent state across calls, use `sed -n` for line ranges, avoid very large outputs, run long-lived commands in the background.
- The Edit tool `str_replace_editor` has `view`, `create`, `str_replace`, `insert`, and `undo_edit`. `view` shows `cat -n` output for files and a two-level non-hidden listing for directories, `create` fails if the file exists, and oversized output is truncated and marked clipped.
- String replacement was the most reliable edit format: `old_str` must match exactly and exactly once, otherwise the model gets an error and retries.
- Error-proofing: absolute paths are required, which eliminated relative-path mistakes after the agent changed directories. Tool descriptions deserve as much design attention as human interfaces, and the team iterated descriptions to pre-empt misunderstandings.
- The prompt states the repo location and the PR description, says test files are already handled (do not modify tests), asks for minimal non-test changes, and suggests five steps: explore the repo, write a script that reproduces the error, edit source, rerun the reproduction, consider edge cases. It is deliberately not long.
- The newer model self-corrects more and tries different solutions instead of repeating a mistake. An example run (RidgeClassifierCV `store_cv_values`) finished in 12 steps.
- Successful runs sometimes took hundreds of turns and more than 100k tokens.
- Grading noise: environment setup failures and install patches applied twice produced false failures even when the model behaved correctly.
- Hidden tests: the model cannot see grading tests, so it often believes it succeeded when it did not; some fixes were band-aids, and some were correct but mismatched the original tests.
- Multimodal gap: the model could not view files saved to disk or referenced by URL, making Matplotlib-style tasks very hard.

## Harness implications
- [foundation:ownedLoop] Keep the core scaffold minimal (a prompt, a shell tool and an edit tool) and let the model sequence its own steps.
  > give the model as much control as possible and do not hardcode a workflow
- [component:toolExamples] Put operational guidance such as state persistence, output limits and background execution in the tool description.
  > its description carries the guidance
- [foundation:toolHygiene] Make edits exact-match and single-occurrence with an informative error, and require absolute paths.
  > `old_str` must match exactly and exactly once
- [foundation:toolHygiene] Truncate oversized tool output, mark it as clipped and show how to page through it.
  > oversized output is truncated and marked clipped
- [component:taskBudget] Expect long runs of hundreds of turns and 100k+ tokens, and budget and checkpoint for them.
  > Successful runs sometimes took hundreds of turns and more than 100k tokens.
- [stage:build] Before fixing a bug, write a script that reproduces it, rerun it after the fix, and keep its before and after output as evidence.
  > write a script that reproduces the error, edit source, rerun the reproduction
- [foundation:reliability] Separate environment and grading failures from agent failures so infrastructure noise does not look like model error.
  > environment setup failures and install patches applied twice produced false failures
- [gap] Give the agent a way to view images and rendered files it produced.
  > the model could not view files saved to disk or referenced by URL
