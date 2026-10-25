import { rovingTabs } from "../components/ui";
import React from "react";
import type { RunModel } from "../state/derive";
import { useStore, DETAILS_SUBS } from "../state/store";
import { Transcript } from "./Transcript";
import { ContextPanel } from "./Context";
import { GuardrailsPanel } from "./Guardrails";

/** Details: the deep-dive views, one click behind the run tabs. */
export function DetailsPanel({ model, live }: { model: RunModel; live: RunModel }) {
  const sub = useStore((s) => s.sub);
  const navigate = useStore((s) => s.navigate);
  const flagged = live.guardrails.filter((g) => g.verdict !== "allow").length;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-4 py-1.5 border-b line" role="tablist" aria-label="Details" style={{ background: "var(--bg)" }} onKeyDown={(e) => rovingTabs(e, DETAILS_SUBS.map((d) => d.id), sub, (id) => navigate({ sub: id as typeof sub, view: "details" }))}>
        {DETAILS_SUBS.map((d) => (
          <button key={d.id} role="tab" aria-selected={sub === d.id} tabIndex={sub === d.id ? 0 : -1} className="subtab" onClick={() => navigate({ sub: d.id, view: "details" })}>
            {d.label}
            {d.id === "guardrails" && flagged > 0 && <span className="ml-1.5 faint mono">{flagged}</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0" role="tabpanel">
        {sub === "transcript" ? <Transcript model={model} /> : sub === "context" ? <ContextPanel model={model} /> : <GuardrailsPanel model={model} />}
      </div>
    </div>
  );
}
