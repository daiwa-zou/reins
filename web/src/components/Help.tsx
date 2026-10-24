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
    </Modal>
  );
}
