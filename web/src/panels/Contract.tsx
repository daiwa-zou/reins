import React from "react";
import type { RunModel } from "../state/derive";
import { Badge, Empty, RoleChip } from "../components/ui";

/** How a round's report came about, when the evaluator did not report on its own (forced at the turn cap, or synthesised by the harness). */
function OriginBadge({ origin }: { origin?: "reported" | "forced" | "synthesised" }) {
  if (!origin || origin === "reported") return null;
  const title = origin === "forced" ? "The evaluator ran out of turns and reported in a final forced call; criteria it did not reach are unverified." : "The evaluator never called report_evaluation, so the harness wrote this report with every criterion unverified.";
  return (
    <Badge tone="warn" title={title}>
      {origin === "forced" ? "forced report" : "synthesised report"}
    </Badge>
  );
}

/** ✓ pass, ✕ fail, ? unverified (not checked: the evaluator ran out of turns). */
function Mark({ pass, unverified }: { pass: boolean; unverified?: boolean }) {
  return pass ? <>✓</> : unverified ? <>?</> : <>✕</>;
}

function markClass(r: { pass: boolean; unverified?: boolean }) {
  return r.pass ? "bg-[var(--ok-soft)] text-[var(--ok)]" : r.unverified ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--bad-soft)] text-[var(--bad)]";
}

/** Criteria × evaluation rounds. A contract is only useful if you can see it being enforced. */
export function ContractPanel({ model }: { model: RunModel }) {
  if (!model.contract.length && !model.contractHistory.length)
    return <Empty title="No contract yet" body="Once the planner finishes, the builder proposes a definition of done and the evaluator reviews it. You approve the final list before any code is written." />;
  const rounds = model.evaluations;
  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {model.contract.length > 0 && (
          <div className="card overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider faint">
                  <th className="px-3 py-2 w-10">id</th>
                  <th className="px-3 py-2">criterion</th>
                  <th className="px-3 py-2 w-16">weight</th>
                  {rounds.map((r) => (
                    <th key={r.round} className="px-3 py-2 w-24 text-center" title={r.origin && r.origin !== "reported" ? `${r.origin} report` : undefined}>
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
                    <td className="px-3 py-2">
                      <div>{c.text}</div>
                      <div className="muted mono text-[11px] mt-0.5">verify: {c.verify}</div>
                    </td>
                    <td className="px-3 py-2">{c.hard ? <Badge tone="neutral">hard</Badge> : <span className="faint">soft</span>}</td>
                    {rounds.map((r) => {
                      const res = r.results.find((x) => x.id === c.id);
                      return (
                        <td key={r.round} className="px-3 py-2 text-center">
                          {res ? (
                            <span title={res.unverified ? `Unverified: ${res.evidence}` : res.evidence} className={`inline-flex items-center justify-center w-6 h-6 rounded-md font-bold ${markClass(res)}`}>
                              <Mark pass={res.pass} unverified={res.unverified} />
                            </span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rounds.map((r) => (
          <div key={r.round} className="card p-4 border-l-4" style={{ borderLeftColor: r.verdict === "pass" ? "var(--ok)" : "var(--bad)" }}>
            <div className="flex items-center gap-2 mb-2">
              <RoleChip role="evaluator" />
              <Badge tone={r.verdict === "pass" ? "ok" : "bad"}>
                round {r.round} · {r.verdict}
              </Badge>
              <OriginBadge origin={r.origin} />
              {r.results.some((x) => x.unverified) && <span className="muted text-[12px]">{r.results.filter((x) => x.unverified).length} unverified</span>}
            </div>
            <div className="leading-relaxed mb-3">{r.summary}</div>
            <div className="flex flex-col gap-1.5">
              {r.results.map((x) => (
                <div key={x.id} className="flex gap-2 text-[12.5px]">
                  <span className={`font-bold shrink-0 w-12 ${x.pass ? "text-[var(--ok)]" : x.unverified ? "text-[var(--warn)]" : "text-[var(--bad)]"}`}>
                    <Mark pass={x.pass} unverified={x.unverified} /> {x.id}
                  </span>
                  <span className="muted">{x.evidence}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {model.contractHistory.length > 0 && (
          <div>
            <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-2">How the contract was negotiated</div>
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
          </div>
        )}
      </div>
    </div>
  );
}
