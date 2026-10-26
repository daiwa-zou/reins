import React from "react";
import { Modal, Kbd } from "./ui";
import { useStore } from "../state/store";
import { SHORTCUTS } from "../state/nav";

/** Generated from the nav shortcut map, the same one App binds, so the two cannot drift. */
export function Help() {
  const openModal = useStore((s) => s.openModal);
  return (
    <Modal title="Keyboard shortcuts" onClose={() => openModal(null)} width={520}>
      <table className="w-full">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.key} className="border-b line last:border-0">
              <td className="py-1.5 w-20">
                <Kbd>{s.display}</Kbd>
              </td>
              <td className="py-1.5 muted">{s.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-small mt-4 leading-relaxed">
        Shortcuts are ignored while you type in a text field. The left sidebar switches between Runs, Reliability, Harness and Lessons; a selected run has four views (Activity, Contract,
        Changes, Details), and Details has Transcript, Context and Guardrails. While a run is live, type in the box at the bottom of Activity to leave the agent an operator note. It is
        delivered before the next model call as an operator-authority message, never mixed into tool output.
      </p>
      <div className="section-label mt-4 mb-1">Glossary</div>
      <dl className="text-small grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 leading-snug" data-glossary>
        {(
          [
            ["Effort", "What the harness spends on the task: Low, Medium, High or Max. Sets the planner, contract, evaluator, scouts, fix rounds, turns and budget. Not the roles' reasoning effort."],
            ["Supervision", "How much you want to be asked: Unattended, Check in at gates (plan, contract, evaluation) or Ask before every write (every pause, guardrail mode ask)."],
            ["Tier", "Who decides whether a component is on: Always on (only an experiment turns it off), Set by Effort, or Follows settings (Supervision and the engine)."],
            ["Experiment", "A run with an always-on component switched off (POST /api/runs with ablated: [...]), recorded as ablated and shown on the title chip."],
            ["Domains", "What kind of project: Web, CLI, Go, Python and any domain a lesson names. Zero or more, layered over Effort and Supervision; they may only raise effort and tighten supervision."],
            ["Saved preset", "Your own saved settings (Customize › Save as preset…). Manage them and your default on the Harness page."],
            ["Component", "One switch in the harness, such as the planner or the evaluator. Effort sets them; New run › Customize overrides one; docs/configuring.md explains each."],
            ["Lesson", "A distilled engineering post. Lessons explain where a component, a domain or a guidance line comes from."],
          ] as const
        ).map(([term, text]) => (
          <React.Fragment key={term}>
            <dt className="font-semibold">{term}</dt>
            <dd className="muted">{text}</dd>
          </React.Fragment>
        ))}
      </dl>
    </Modal>
  );
}
