# Harness design for long-running application development
Source: https://www.anthropic.com/engineering/harness-design-long-running-apps
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Separate skeptical evaluator with live access and hard thresholds | Evaluator role (`prompts.ts:38`), hard criteria fail the sprint (`orchestrator.ts:250`); bash access but no browser | partial |
| Negotiate contracts before work; user edits and approves | Contract phase (`orchestrator.ts:180-215`); editable ApprovalCard (`ApprovalCard.tsx:27`) | implemented |
| File-based handoff between agents | `.reins/spec.md`, `contract.json`, `evaluation.md`, `progress.md` (`orchestrator.ts:187,215,252`) | implemented |
| Cost and time per phase | `phase.finished` carries usage, cost, duration; Inspector phases section and stepper | implemented |
| Individually toggleable components (ablation) | 20 switches in `shared/components.ts:11`; Harness tab 'run without' (`web/src/panels/Harness.tsx:16`) | implemented |
| Context strategy (compaction vs reset) visible and configurable | compaction, contextEditing, resetWithHandoff switches with thresholds; Context tab shows the markers (`ContextGauge.tsx:22`) | implemented |
| Calibrate the evaluator by reading logs and revising its prompt | Evaluator prompt encodes the 'talks itself into approving' failure (`prompts.ts:41`); prompts not editable from the UI | partial |

## Gaps
- Expose role prompts as editable, versioned text in the Harness tab so evaluator calibration is a product action.
- A Playwright-backed screenshot tool for the evaluator when the contract names a URL.
