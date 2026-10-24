# Raising the bar on SWE-bench Verified with Claude 3.5 Sonnet
Source: https://www.anthropic.com/engineering/swe-bench-sonnet
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Minimal core scaffold; let the model sequence its own steps | Each role is one prompt plus tools (`prompts.ts`); scaffolding is switchable (`shared/components.ts:11`) | implemented |
| Operational guidance inside tool descriptions | Descriptions in `registry.ts` carry limits and usage hints (bash output caps, edit uniqueness, read offsets) | implemented |
| Exact-match single-occurrence edits with informative errors; create refuses to overwrite | `registry.ts:166` edit_file enforces exactly one match with actionable errors; write_file overwrites (reports 'Overwrote') | partial |
| Truncate and mark clipped output; teach paging | `registry.ts:56` truncate keeps head and tail with a narrowing hint; read_file offset/limit | implemented |
| Expect long runs: budget, checkpoint, display progress | Budget and turn caps; phase stepper and feed; commits per phase | implemented |
| Reproduce, fix, rerun loop with visible evidence | Evaluator evidence per criterion (`Contract.tsx`); builder told to verify; reproduction not a distinct step | partial |
| Separate environment failures from agent failures | Interrupted runs excluded from rates (`trials.ts:21`); timeouts marked in tool results | partial |
| Image and file viewing tools | read_file only; no image viewing | gap |

## Gaps
- Make write_file refuse to overwrite an existing file unless `overwrite: true` is passed.
- Add a `view_image` tool returning an image block for PNG/JPEG files in the workspace.
