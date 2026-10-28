import React from "react";
import type { CriterionCheck, EvaluationRound, RunModel } from "../state/derive";
import { Badge, Collapsible, Empty, Pre, RoleChip } from "../components/ui";
import type { ContractCriterion } from "@shared/types";

/**
 * The contract as a checklist a person can read: what "done" means, how each
 * item is checked, whether it must pass, and where it stands right now. Items
 * are checked off live as the builder verifies them (check_criterion), then
 * settled by the evaluator's verdict. The round-by-round detail sits below.
 */

/** Where one criterion stands: the newest of the evaluator's verdict and the builder's own check. */
type Standing =
  | { kind: "pending" }
  | { kind: "checked"; evidence: string; ts: string }
  | { kind: "checked-failing"; evidence: string; ts: string }
  | { kind: "verified"; evidence: string; round: EvaluationRound }
  | { kind: "failed"; evidence: string; round: EvaluationRound }
  | { kind: "unverified"; evidence: string; round: EvaluationRound };

const STANDING: Record<Standing["kind"], { mark: string; tone: "ok" | "bad" | "warn" | "accent" | "neutral"; label: string }> = {
  pending: { mark: "○", tone: "neutral", label: "Not checked yet" },
  checked: { mark: "✓", tone: "accent", label: "Checked off by the builder; the evaluator has not verified it yet" },
  "checked-failing": { mark: "✕", tone: "warn", label: "The builder ran the check and saw it fail; it is still working on it" },
  verified: { mark: "✓", tone: "ok", label: "Verified by the evaluator" },
  failed: { mark: "✕", tone: "bad", label: "Failed when the evaluator checked it" },
  unverified: { mark: "?", tone: "warn", label: "The evaluator ran out of turns before checking it" },
};

function standingOf(c: ContractCriterion, latest: EvaluationRound | undefined, check: CriterionCheck | undefined): Standing {
  const res = latest?.results.find((x) => x.id === c.id);
  // A check made after the last evaluation (a fix round) is the newest word on the criterion.
  if (check && (!latest || check.seq > latest.seq)) return { kind: check.pass ? "checked" : "checked-failing", evidence: check.evidence, ts: check.ts };
  if (res && latest) return { kind: res.pass ? "verified" : res.unverified ? "unverified" : "failed", evidence: res.evidence, round: latest };
  if (check) return { kind: check.pass ? "checked" : "checked-failing", evidence: check.evidence, ts: check.ts };
  return { kind: "pending" };
}

/** "round 2", or "P2 · round 2" when the run has work packages (rounds restart at 1 for every package). */
const roundLabel = (r: EvaluationRound) => `${r.package ? `${r.package.id} · ` : ""}round ${r.round}`;
const roundKey = (r: EvaluationRound) => `${r.package?.id ?? ""}#${r.round}`;

function Mark({ standing, size = "w-7 h-7 text-[15px]" }: { standing: Standing["kind"]; size?: string }) {
  const s = STANDING[standing];
  const cls = s.tone === "neutral" ? "faint border line" : `text-[var(--${s.tone})] bg-[var(--${s.tone}-soft)]`;
  return (
    <span className={`inline-flex items-center justify-center rounded-md font-bold shrink-0 ${size} ${cls}`} role="img" aria-label={s.label} title={s.label}>
      {s.mark}
    </span>
  );
}

export function ContractPanel({ model }: { model: RunModel }) {
  if (!model.contract.length && !model.contractHistory.length)
    return <Empty title="No contract yet" body="Once the planner finishes, the builder proposes a definition of done and the evaluator reviews it. You approve the final list before any code is written." />;
  const rounds = model.evaluations;
  // Only the rounds that judged the latest contract (the same package) are its columns.
  const own = rounds.filter((r) => (r.package?.id ?? null) === (model.contractPackage?.id ?? null));
  const latest = own[own.length - 1];
  const items = model.contract.map((c) => ({ c, standing: standingOf(c, latest, model.checks[c.id]) }));
  const hard = items.filter((i) => i.c.hard);
  const verifiedHard = hard.filter((i) => i.standing.kind === "verified").length;
  const checked = items.filter((i) => i.standing.kind === "checked" || i.standing.kind === "verified").length;
  const pkg = model.contractPackage;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {model.contract.length > 0 && (
          <section className="card p-4" aria-labelledby="contract-h" data-contract-checklist>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="contract-h" className="font-semibold text-title m-0">
                What “done” means{pkg ? ` for ${pkg.id}: ${pkg.title}` : ""}
              </h2>
              <span className="muted text-small">
                {model.contract.length} criteria · {hard.length} must pass{items.length - hard.length ? ` · ${items.length - hard.length} nice to have` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-small" data-contract-summary>
              <Badge tone={verifiedHard === hard.length && hard.length > 0 ? "ok" : "neutral"}>
                {verifiedHard} of {hard.length} must-pass verified by the evaluator
              </Badge>
              <Badge tone={checked ? "accent" : "neutral"}>
                {checked} of {model.contract.length} checked off
              </Badge>
              {latest && (
                <Badge tone={latest.verdict === "pass" ? "ok" : "bad"} title={latest.summary}>
                  last evaluation: {latest.verdict}
                </Badge>
              )}
            </div>
            <p className="muted text-small mt-2 leading-relaxed">
              Each item below is an observable outcome and the exact step that checks it. The builder checks items off as it verifies them; the evaluator then re-runs every check itself, and a must-pass item that fails sends the builder back for a fix round.
            </p>
            <ol className="mt-3 flex flex-col gap-2 list-none p-0 m-0">
              {items.map(({ c, standing }) => {
                const s = STANDING[standing.kind];
                const evidence = "evidence" in standing ? standing.evidence : "";
                return (
                  <li key={c.id} className="rounded-lg border line p-3 flex gap-3 items-start" data-criterion={c.id} data-standing={standing.kind}>
                    <Mark standing={standing.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono faint text-caption">{c.id}</span>
                        <span className="font-medium leading-snug">{c.text}</span>
                        {c.hard ? (
                          <Badge tone="neutral" title="Failing this fails the package and starts a fix round">
                            must pass
                          </Badge>
                        ) : (
                          <Badge tone="neutral" title="Reported by the evaluator but never blocks">
                            nice to have
                          </Badge>
                        )}
                      </div>
                      <div className="text-small mt-1">
                        <span className="muted">How it is checked: </span>
                        <span className="mono text-[11.5px]">{c.verify}</span>
                      </div>
                      <div className={`text-small mt-1 ${s.tone === "neutral" ? "faint" : `text-[var(--${s.tone})]`}`}>
                        {s.label}
                        {"round" in standing ? ` (${roundLabel(standing.round)})` : ""}
                      </div>
                      {evidence && (
                        <Collapsible summary="what was seen" className="mt-1">
                          <Pre max={600}>{evidence}</Pre>
                        </Collapsible>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-caption muted" aria-label="Legend">
              {(["verified", "checked", "failed", "unverified", "pending"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <Mark standing={k} size="w-4 h-4 text-[10px]" /> {k === "checked" ? "checked off by the builder" : k === "verified" ? "verified by the evaluator" : k === "failed" ? "failed" : k === "unverified" ? "not reached by the evaluator" : "not checked yet"}
                </span>
              ))}
            </div>
          </section>
        )}

        {own.length > 0 && (
          <Collapsible summary={<span className="font-semibold">Evaluation rounds · {own.length}</span>} defaultOpen={own.length > 1 || latest?.verdict === "fail"}>
            <div className="card overflow-hidden mb-3">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider faint">
                    <th className="px-3 py-2 w-10">id</th>
                    <th className="px-3 py-2">criterion</th>
                    {own.map((r) => (
                      <th key={roundKey(r)} className="px-3 py-2 w-24 text-center" title={r.origin && r.origin !== "reported" ? `${r.origin} report` : undefined}>
                        round {r.round}
                        {r.origin && r.origin !== "reported" ? <span className="block normal-case tracking-normal text-[var(--warn)]">{r.origin}</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {model.contract.map((c) => (
                    <tr key={c.id} className="border-t line align-top">
                      <td className="px-3 py-2 mono faint">{c.id}</td>
                      <td className="px-3 py-2">{c.text}</td>
                      {own.map((r) => {
                        const res = r.results.find((x) => x.id === c.id);
                        const k: Standing["kind"] = !res ? "pending" : res.pass ? "verified" : res.unverified ? "unverified" : "failed";
                        return (
                          <td key={roundKey(r)} className="px-3 py-2 text-center">
                            {res ? <span title={res.evidence}><Mark standing={k} size="w-6 h-6 text-[13px]" /></span> : <span className="faint">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3">
              {rounds.map((r) => (
                <div key={roundKey(r)} className="card p-4 border-l-4" style={{ borderLeftColor: r.verdict === "pass" ? "var(--ok)" : "var(--bad)" }}>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <RoleChip role="evaluator" />
                    <Badge tone={r.verdict === "pass" ? "ok" : "bad"}>
                      {roundLabel(r)} · {r.verdict}
                    </Badge>
                    {r.origin && r.origin !== "reported" && (
                      <Badge tone="warn" title={r.origin === "forced" ? "The evaluator ran out of turns and reported in a final forced call; criteria it did not reach are unverified." : "The evaluator never called report_evaluation, so the harness wrote this report with every criterion unverified."}>
                        {r.origin === "forced" ? "forced report" : "synthesised report"}
                      </Badge>
                    )}
                    {r.results.some((x) => x.unverified) && <span className="muted text-[12px]">{r.results.filter((x) => x.unverified).length} unverified</span>}
                  </div>
                  <div className="leading-relaxed mb-3">{r.summary}</div>
                  <div className="flex flex-col gap-1.5">
                    {r.results.map((x) => (
                      <div key={x.id} className="flex gap-2 text-[12.5px]">
                        <span className={`font-bold shrink-0 w-12 ${x.pass ? "text-[var(--ok)]" : x.unverified ? "text-[var(--warn)]" : "text-[var(--bad)]"}`}>
                          {x.pass ? "✓" : x.unverified ? "?" : "✕"} {x.id}
                        </span>
                        <span className="muted">{x.evidence}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {model.contractHistory.length > 0 && (
          <Collapsible summary={<span className="font-semibold">How the contract was negotiated · {model.contractHistory.length} proposals</span>}>
            <div className="flex flex-col gap-2">
              {model.contractHistory.map((h, i) => (
                <div key={i} className="card p-3">
                  <div className="flex items-center gap-2 text-[12px] mb-1">
                    <RoleChip role={h.by} />
                    <span className="muted">{h.criteria.length} criteria</span>
                  </div>
                  <div className="text-[12.5px] leading-relaxed">{h.rationale}</div>
                </div>
              ))}
            </div>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
