import React from "react";
import { Modal, Kbd } from "./ui";
import { TABS, useStore } from "../state/store";

export function Help() {
  const openModal = useStore((s) => s.openModal);
  const rows: [React.ReactNode, string][] = [
    [<Kbd>n</Kbd>, "New run"],
    [<Kbd>d</Kbd>, "Open the demo (creates it the first time)"],
    [<Kbd>space</Kbd>, "Pause / resume the selected live run (ignored while a control has focus)"],
    [
      <>
        <Kbd>1</Kbd>…<Kbd>9</Kbd>
      </>,
      TABS.map((t) => t.label).join(" · "),
    ],
    [<Kbd>?</Kbd>, "This help"],
    [<Kbd>esc</Kbd>, "Close dialogs"],
  ];
  return (
    <Modal title="Keyboard" onClose={() => openModal(null)} width={520}>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-b line last:border-0">
              <td className="py-2 w-28">{k}</td>
              <td className="py-2 muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-[12px] mt-4">
        While a run is live, type in the box at the bottom of the Stage to leave the agent an operator note. It is delivered before the next model call as an operator-authority message, never mixed into tool output.
      </p>
    </Modal>
  );
}
