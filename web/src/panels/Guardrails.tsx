import React from "react";
import type { RunModel } from "../state/derive";
import { Badge, Empty, RoleChip, Stat } from "../components/ui";
import { useStore } from "../state/store";
import { clock } from "../lib/format";

export function GuardrailsPanel({ model }: { model: RunModel }) {
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const cfg = model.config;
  const decisions = model.guardrails;
  const counts: Record<"allow" | "ask" | "deny", number> = { allow: 0, ask: 0, deny: 0 };
  for (const d of decisions) counts[d.verdict]++;
  const bySource: Record<"rule" | "classifier" | "policy" | "user", number> = { rule: 0, classifier: 0, policy: 0, user: 0 };
  for (const d of decisions) bySource[d.source]++;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="grid md:grid-cols-4 gap-3">
          <Stat capitalize label="Mode" value={cfg?.guardrail.mode ?? "—"} sub={cfg?.guardrail.mode === "auto" ? "rules decide; the classifier settles the ambiguous" : cfg?.guardrail.mode === "ask" ? "anything not read-only asks you" : "everything but hard denies runs"} />
          <Stat capitalize label="Network" value={cfg?.guardrail.allowNetwork ? "allowed" : "off"} sub="downloads and remote calls need approval when off" />
          <Stat label="Decisions" value={String(decisions.length)} sub={`${counts.allow} allow · ${counts.ask} ask · ${counts.deny} deny`} />
          <Stat label="Asked you" value={String(bySource.user)} sub={`${bySource.classifier} settled by the classifier`} tone={bySource.user > 5 ? "warn" : undefined} />
        </div>

        <div className="card p-4 text-[12.5px] leading-relaxed">
          <div className="font-semibold mb-1">How actions are gated</div>
          <ol className="list-decimal pl-5 flex flex-col gap-1 muted">
            <li>
              <b className="text-[var(--fg)]">Hard denies</b> never run in any mode: recursive deletes of root or home, sudo, piping downloads into a shell, force pushes.
            </li>
            <li>
              <b className="text-[var(--fg)]">Workspace confinement.</b> File tools cannot write outside the workspace. Shell commands mentioning outside paths are flagged.
            </li>
            <li>
              <b className="text-[var(--fg)]">Read-only</b> commands and file reads always run, in parallel.
            </li>
            <li>
              <b className="text-[var(--fg)]">Risky patterns</b> (pushes, package publishes, recursive deletes, network when off) go to the classifier in auto mode. It sees only your task and the command, never the agent's prose, and answers allow, ask or deny with a reason.
            </li>
            <li>
              <b className="text-[var(--fg)]">Tool output</b> is scanned for instruction-shaped text and wrapped as untrusted data when found.
            </li>
          </ol>
          <button className="underline mt-2" onClick={() => setLessonFilter("claude-code-auto-mode")}>
            Read the lesson →
          </button>
        </div>

        {decisions.length === 0 ? (
          <Empty title="No gated actions yet" body="Decisions appear here as the agent runs commands." />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider faint">
                  <th className="px-3 py-2 w-20">time</th>
                  <th className="px-3 py-2 w-24">role</th>
                  <th className="px-3 py-2 w-16">verdict</th>
                  <th className="px-3 py-2 w-24">by</th>
                  <th className="px-3 py-2">action</th>
                  <th className="px-3 py-2">why</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => {
                  const call = model.calls.find((c) => c.toolUseId === d.toolUseId);
                  return (
                    <tr key={`${d.seq}`} className="border-t line align-top">
                      <td className="px-3 py-2 mono faint">{clock(d.ts)}</td>
                      <td className="px-3 py-2">
                        <RoleChip role={d.role} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={d.verdict === "allow" ? "ok" : d.verdict === "ask" ? "warn" : "bad"}>{d.verdict}</Badge>
                      </td>
                      <td className="px-3 py-2 muted">
                        {d.source}
                        <div className="faint text-[11px] mono">{d.rule}</div>
                      </td>
                      <td className="px-3 py-2 mono text-[11.5px] break-all">{call ? describe(call.name, call.input) : d.tool}</td>
                      <td className="px-3 py-2 muted">{d.rationale}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function describe(name: string, input: any): string {
  if (name === "bash") return `$ ${input?.command ?? ""}`;
  if (input?.path) return `${name} ${input.path}`;
  return name;
}
