import React, { useState } from "react";
import type { ApprovalRequest, ContractCriterion } from "@shared/types";
import { api } from "../lib/api";
import { useStore } from "../state/store";
import { Pre, Badge } from "./ui";

/**
 * Inline approval. Contracts are editable in place: this is the one moment
 * where a person shapes what the evaluator will hold the builder to.
 */
export function ApprovalCard({ request, runId }: { request: ApprovalRequest; runId: string }) {
  const toastMsg = useStore((s) => s.toastMsg);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [criteria, setCriteria] = useState<ContractCriterion[]>(() => (request.kind === "contract" ? (request.payload as ContractCriterion[]) : []));

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await api.approve(runId, request.approvalId, decision, note || undefined, request.kind === "contract" ? criteria : undefined);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<ContractCriterion>) => setCriteria((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="card p-4 border-l-4 fade-in" style={{ borderLeftColor: "var(--warn)", boxShadow: "var(--shadow)" }}>
      <div className="flex items-center gap-2">
        <Badge tone="warn">needs you</Badge>
        <div className="font-semibold">{request.title}</div>
      </div>
      <div className="muted text-[12.5px] mt-1 leading-relaxed">{request.detail}</div>

      {request.kind === "action" && (
        <div className="mt-3">
          <Pre max={600}>{formatAction(request.payload)}</Pre>
        </div>
      )}

      {request.kind === "contract" && (
        <div className="mt-3 flex flex-col gap-2">
          {criteria.map((c, i) => (
            <div key={i} className="rounded-lg border line p-2.5 flex gap-2 items-start">
              <span className="mono faint text-[11px] w-6 pt-1.5 shrink-0">{c.id}</span>
              <div className="flex-1 flex flex-col gap-1.5">
                <input className="input" value={c.text} onChange={(e) => update(i, { text: e.target.value })} aria-label={`Criterion ${c.id}`} />
                <div className="flex items-center gap-2">
                  <span className="faint text-[11px] shrink-0">verify</span>
                  <input className="input mono" style={{ fontSize: 11.5, padding: "4px 8px" }} value={c.verify} onChange={(e) => update(i, { verify: e.target.value })} aria-label={`Verification for ${c.id}`} />
                </div>
              </div>
              <label className="flex items-center gap-1 text-[11px] muted pt-1.5 shrink-0 cursor-pointer" title="A hard criterion that fails fails the sprint.">
                <input type="checkbox" checked={c.hard} onChange={(e) => update(i, { hard: e.target.checked })} /> hard
              </label>
              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove criterion">
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm self-start" onClick={() => setCriteria((cs) => [...cs, { id: `C${cs.length + 1}`, text: "", verify: "", hard: true }])}>
            + Add a criterion
          </button>
        </div>
      )}

      {request.kind === "phase" && request.payload != null && (
        <div className="mt-3">
          <Pre max={1200}>{typeof request.payload === "string" ? request.payload : (request.payload as any).spec ?? JSON.stringify(request.payload, null, 2)}</Pre>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input className="input" placeholder="Optional note to the agent (why, or what to do instead)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" disabled={busy} onClick={() => decide("reject")}>
          Reject
        </button>
        <button className="btn btn-primary" disabled={busy || (request.kind === "contract" && criteria.some((c) => !c.text.trim()))} onClick={() => decide("approve")}>
          {request.kind === "contract" ? "Approve contract" : "Approve"}
        </button>
      </div>
    </div>
  );
}

function formatAction(p: unknown): string {
  const a = p as { tool?: string; input?: any };
  if (a?.tool === "bash" && a.input?.command) return `$ ${a.input.command}`;
  return JSON.stringify(p, null, 2);
}
