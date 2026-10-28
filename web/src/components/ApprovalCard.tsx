import React, { useState } from "react";
import type { ApprovalDecision, ApprovalRequest, ContractCriterion, PublishDraft } from "@shared/types";
import { api } from "../lib/api";
import { useStore, type ApprovalDraft as ApprovalDraftFields } from "../state/store";
import { Pre, Badge } from "./ui";
import { dropImplication, editImplication, IMPLICATION_KINDS, initLessonDraft, parseDomains, setDraftStanding, toLessonEdits, type DraftLessonPayload, type LessonDraftState } from "../state/lessonDraft";

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
  lesson: {
    approve: "Adopt: the lesson, with your edits, is written to your lesson library with the standing you picked.",
    reject: "Drop: the draft is discarded and nothing is written to your library.",
  },
  publish: {
    approve: "Approve: the branch is pushed and the pull request is opened with the title and description as shown (your edits included).",
    reject: "Request changes: the builder rewrites the draft from your note and this card comes back. Reject: the branch stays local and the run ends here.",
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
  // A lesson approval (intake job): the implications to keep, edited, and the standing.
  const lesson: LessonDraftState = draft?.lesson ?? initLessonDraft(request.kind === "lesson" ? (request.payload as DraftLessonPayload) : null);
  const payload = request.payload as any;
  // A pull request draft (publish cards): the title and description as proposed, then as edited here.
  const publish: PublishDraft = draft?.publish ?? (request.kind === "publish" ? { title: String(payload?.title ?? ""), body: String(payload?.body ?? "") } : { title: "", body: "" });
  const patch = (p: Partial<ApprovalDraftFields>) => setDraft(request.approvalId, { criteria, note, lesson: draft?.lesson, publish: draft?.publish, ...p });
  const setCriteria = (next: ContractCriterion[]) => patch({ criteria: next });
  const setNote = (next: string) => patch({ note: next });
  const setLesson = (next: LessonDraftState) => patch({ lesson: next });
  const setPublish = (next: PublishDraft) => patch({ publish: next });

  const decide = async (decision: ApprovalDecision) => {
    setBusy(true);
    try {
      await api.approve(runId, request.approvalId, decision, note || undefined, {
        criteria: request.kind === "contract" ? criteria : undefined,
        lesson: request.kind === "lesson" ? toLessonEdits(lesson) : undefined,
        publish: request.kind === "publish" ? publish : undefined,
      });
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
  const invalid = request.kind === "contract" ? criteria.filter((c) => !c.text.trim() || !c.verify.trim()).length : request.kind === "publish" && !publish.title.trim() ? 1 : 0;
  const rationale = request.kind === "action" ? request.detail : null;
  const isPublish = request.kind === "publish";
  const revision = isPublish ? Number(payload?.revision ?? 0) : 0;

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

      {request.kind === "lesson" && <LessonDraftEditor payload={payload as DraftLessonPayload} state={lesson} onChange={setLesson} />}

      {isPublish && (
        <div className="mt-3 flex flex-col gap-2" data-publish-draft>
          <div className="text-[12px] muted flex flex-wrap gap-x-3 gap-y-1">
            <span>
              <span className="faint">branch</span> <span className="mono">{payload?.branch}</span>
            </span>
            <span>
              <span className="faint">onto</span> <span className="mono">{payload?.base}</span>
            </span>
            {revision > 0 && <span className="faint">redrafted {revision} time{revision === 1 ? "" : "s"} on your request</span>}
          </div>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Title
            <input className="input font-normal" value={publish.title} maxLength={200} onChange={(e) => setPublish({ ...publish, title: e.target.value })} aria-label="Pull request title" placeholder="One line" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Description <span className="faint font-normal">(Markdown; this is the pull request body)</span>
            <textarea className="input mono font-normal" style={{ fontSize: 11.5, lineHeight: 1.5 }} rows={14} value={publish.body} onChange={(e) => setPublish({ ...publish, body: e.target.value })} aria-label="Pull request description" />
          </label>
        </div>
      )}

      {request.kind === "phase" && payload != null && (
        <div className="mt-3">
          <Pre max={1200}>{typeof payload === "string" ? payload : payload.spec ?? JSON.stringify(payload, null, 2)}</Pre>
          {typeof payload?.breakdown === "string" && (
            <div className="mt-2">
              <div className="section-label" style={{ color: "var(--fg-muted)" }}>
                Work packages ({payload.packages?.length ?? "?"}, one pull request each)
              </div>
              <Pre max={1200}>{payload.breakdown}</Pre>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input className="input" placeholder={isPublish ? "What should change in the draft? (needed to request changes)" : "Optional note to the agent (why, or what to do instead)"} value={note} onChange={(e) => setNote(e.target.value)} aria-label={isPublish ? "What should change" : "Note to the agent"} />
        <button className="btn" disabled={busy || disabled} onClick={() => decide("reject")}>
          Reject
        </button>
        {isPublish && (
          <button className="btn" disabled={busy || disabled || !note.trim()} onClick={() => decide("revise")} title={note.trim() ? "The builder rewrites the draft from your note" : "Write what should change first"} data-request-changes>
            Request changes
          </button>
        )}
        <button className="btn btn-primary" disabled={busy || disabled || invalid > 0} onClick={() => decide("approve")} title={invalid ? (isPublish ? "The title cannot be empty" : `${invalid} criterion(s) need both a text and a verify step`) : undefined}>
          {request.kind === "contract" ? "Approve contract" : request.kind === "lesson" ? `Adopt lesson (${toLessonEdits(lesson).implications.length} implication${toLessonEdits(lesson).implications.length === 1 ? "" : "s"})` : isPublish ? "Approve and open the pull request" : "Approve"}
        </button>
      </div>
      <div className="text-[11.5px] muted mt-2 leading-relaxed">
        {CONSEQUENCE[request.kind].approve} {CONSEQUENCE[request.kind].reject}
        {invalid > 0 && !isPublish && <span className="text-[var(--warn)]"> {invalid} criterion(s) still need both a text and a verify step.</span>}
        {invalid > 0 && isPublish && <span className="text-[var(--warn)]"> The title cannot be empty.</span>}
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

/** The lesson approval card body: each implication (kind, target, claim, quote, domains), editable or droppable, and the standing. */
function LessonDraftEditor({ payload, state, onChange }: { payload: DraftLessonPayload; state: LessonDraftState; onChange: (s: LessonDraftState) => void }) {
  return (
    <div className="mt-3 flex flex-col gap-2" data-lesson-draft>
      <div className="text-[12.5px]">
        <span className="font-semibold">{payload?.title}</span> <span className="mono faint">{payload?.slug}</span>
        {payload?.url && <span className="muted"> · {payload.url}</span>}
      </div>
      {payload?.takeaway && <div className="muted text-[12px] leading-relaxed">{payload.takeaway}</div>}
      {state.items.map((imp, i) => (
        <div key={i} className={`rounded-lg border line p-2.5 flex flex-col gap-1.5 ${imp.dropped ? "opacity-50" : ""}`} data-lesson-implication={i}>
          <div className="flex items-center gap-2">
            <select className="input" style={{ width: 120 }} value={imp.kind} disabled={imp.dropped} onChange={(e) => onChange(editImplication(state, i, { kind: e.target.value as typeof imp.kind }))} aria-label={`Kind of implication ${i + 1}`}>
              {IMPLICATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input className="input mono" style={{ width: 160 }} value={imp.kind === "gap" ? "" : imp.target} placeholder={imp.kind === "gap" ? "no target" : "target id"} disabled={imp.dropped || imp.kind === "gap"} onChange={(e) => onChange(editImplication(state, i, { target: e.target.value }))} aria-label={`Target of implication ${i + 1}`} />
            <input className="input" value={imp.domains.join(", ")} placeholder="domains (e.g. golang, cli)" disabled={imp.dropped} onChange={(e) => onChange(editImplication(state, i, { domains: parseDomains(e.target.value) }))} aria-label={`Domains of implication ${i + 1}`} />
            <button className="btn btn-ghost btn-sm btn-danger shrink-0" onClick={() => onChange(dropImplication(state, i, !imp.dropped))} aria-label={`${imp.dropped ? "Keep" : "Drop"} implication ${i + 1}`}>
              {imp.dropped ? "keep" : "drop"}
            </button>
          </div>
          <input className="input" value={imp.claim} disabled={imp.dropped} onChange={(e) => onChange(editImplication(state, i, { claim: e.target.value }))} aria-label={`Claim of implication ${i + 1}`} />
          {imp.quote && <blockquote className="muted text-[11.5px] border-l-2 line pl-2 italic">“{imp.quote}”</blockquote>}
        </div>
      ))}
      <div className="flex items-center gap-3 text-[12.5px]" role="radiogroup" aria-label="Standing">
        <span className="font-semibold">Standing</span>
        {(["unreviewed", "reviewed"] as const).map((s) => (
          <label key={s} className="inline-flex items-center gap-1 cursor-pointer">
            <input type="radio" name="lesson-standing" checked={state.standing === s} onChange={() => onChange(setDraftStanding(state, s))} />
            {s}
          </label>
        ))}
        <span className="muted text-[11.5px]">Only reviewed implications reach stage prompts and presets; unreviewed ones go to the Ideas list.</span>
      </div>
    </div>
  );
}
