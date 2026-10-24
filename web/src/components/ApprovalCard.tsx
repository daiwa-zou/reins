import React, { useState } from "react";
import type { ApprovalRequest, ContractCriterion } from "@shared/types";
import { api } from "../lib/api";
import { useStore } from "../state/store";
import { Pre, Badge } from "./ui";

const CONSEQUENCE: Record<ApprovalRequest["kind"], { approve: string; reject: string }> = {
  contract: {
    approve: "Approve: the builder starts, and the evaluator will hold it to exactly this list.",
    reject: "Reject: the run ends here (nothing has been built yet); your note is saved in the log. Edit the criteria and approve to continue instead.",
  },
  action: {
    approve: "Approve: the command runs now.",
    reject: "Reject: the agent is told it was declined (with your note) and looks for another way; the run continues.",
  },
  phase: {
    approve: "Approve: the run continues to the next phase.",
    reject: "Reject: the run stops here; what was built so far stays in the workspace.",
  },
};

/**
 * Inline approval. Contracts are editable in place: this is the one moment
 * where a person shapes what the evaluator will hold the builder to. Drafts
 * live in the store so switching tabs does not lose them.
 */
export function ApprovalCard({ request, runId, disabled = false }: { request: ApprovalRequest; runId: string; disabled?: boolean }) {
  const toastMsg = useStore((s) => s.toastMsg);
  const draft = useStore((s) => s.approvalDrafts[request.approvalId]);
  const setDraft = useStore((s) => s.setApprovalDraft);
  const [busy, setBusy] = useState(false);
  const criteria: ContractCriterion[] = draft?.criteria ?? (request.kind === "contract" ? (request.payload as ContractCriterion[]) : []);
  const note = draft?.note ?? "";
  const setCriteria = (next: ContractCriterion[]) => setDraft(request.approvalId, { criteria: next, note });
  const setNote = (next: string) => setDraft(request.approvalId, { criteria, note: next });

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await api.approve(runId, request.approvalId, decision, note || undefined, request.kind === "contract" ? criteria : undefined);
      setDraft(request.approvalId, null);
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<ContractCriterion>) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const nextId = () => {
    const max = criteria.reduce((m, c) => Math.max(m, Number(c.id.replace(/\D/g, "")) || 0), 0);
    return `C${max + 1}`;
  };
  const invalid = request.kind === "contract" ? criteria.filter((c) => !c.text.trim() || !c.verify.trim()).length : 0;
  const payload = request.payload as any;
  const rationale = request.kind === "action" ? request.detail : null;

  return (
    <div className="card p-4 border-l-4 fade-in" style={{ borderLeftColor: "var(--warn)", boxShadow: "var(--shadow)" }} role="region" aria-label={request.title}>
      <div className="flex items-center gap-2">
        <Badge tone="warn">needs you</Badge>
        <div className="font-semibold">{request.title}</div>
      </div>
      {request.kind !== "action" && <div className="muted text-[12.5px] mt-1 leading-relaxed">{request.detail}</div>}

      {request.kind === "action" && (
        <div className="mt-3 flex flex-col gap-2">
          <Pre max={600}>{formatAction(payload)}</Pre>
          {rationale && (
            <div className="text-[12.5px]">
              <span className="faint">Why you are asked:</span> {rationale}
            </div>
          )}
        </div>
      )}

      {request.kind === "contract" && (
        <div className="mt-3 flex flex-col gap-2">
          {criteria.map((c, i) => (
            <div key={c.id + i} className="rounded-lg border line p-2.5 flex gap-2 items-start">
              <span className="mono faint text-[11px] w-6 pt-1.5 shrink-0">{c.id}</span>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <input className="input" value={c.text} onChange={(e) => update(i, { text: e.target.value })} aria-label={`Criterion ${c.id}`} placeholder="An observable outcome" />
                <div className="flex items-center gap-2">
                  <span className="faint text-[11px] shrink-0">verify</span>
                  <input className="input mono" style={{ fontSize: 11.5, padding: "4px 8px" }} value={c.verify} onChange={(e) => update(i, { verify: e.target.value })} aria-label={`Verification for ${c.id}`} placeholder="A command, request or file to check" />
                </div>
              </div>
              <label className="flex items-center gap-1 text-[11px] muted pt-1.5 shrink-0 cursor-pointer" title="Hard: failing this fails the sprint and sends the builder back. Soft: reported but not blocking.">
                <input type="checkbox" checked={c.hard} onChange={(e) => update(i, { hard: e.target.checked })} /> hard
              </label>
              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} aria-label={`Remove criterion ${c.id}`}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm self-start" onClick={() => setCriteria([...criteria, { id: nextId(), text: "", verify: "", hard: true }])}>
            + Add a criterion
          </button>
        </div>
      )}

      {request.kind === "phase" && payload != null && (
        <div className="mt-3">
          <Pre max={1200}>{typeof payload === "string" ? payload : payload.spec ?? JSON.stringify(payload, null, 2)}</Pre>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input className="input" placeholder="Optional note to the agent (why, or what to do instead)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note to the agent" />
        <button className="btn" disabled={busy || disabled} onClick={() => decide("reject")}>
          Reject
        </button>
        <button className="btn btn-primary" disabled={busy || disabled || invalid > 0} onClick={() => decide("approve")} title={invalid ? `${invalid} criterion(s) need both a text and a verify step` : undefined}>
          {request.kind === "contract" ? "Approve contract" : "Approve"}
        </button>
      </div>
      <div className="text-[11.5px] muted mt-2 leading-relaxed">
        {CONSEQUENCE[request.kind].approve} {CONSEQUENCE[request.kind].reject}
        {invalid > 0 && <span className="text-[var(--warn)]"> {invalid} criterion(s) still need both a text and a verify step.</span>}
        {disabled && <span className="text-[var(--warn)]"> You are viewing the past; go back to live to decide.</span>}
      </div>
    </div>
  );
}

function formatAction(p: unknown): string {
  const a = p as { tool?: string; input?: any };
  if (a?.tool === "bash" && a.input?.command) return `$ ${a.input.command}`;
  return JSON.stringify(p, null, 2);
}
