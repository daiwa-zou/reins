import React, { useState } from "react";
import type { FeedItem, RunModel, ToolCall } from "../state/derive";
import { PHASE_LABEL, PHASE_ORDER, isLive } from "../state/derive";
import { useStore } from "../state/store";
import { Badge, Collapsible, Pre, RoleChip, useAutoScroll } from "../components/ui";
import { ApprovalCard } from "../components/ApprovalCard";
import { api } from "../lib/api";
import { clock, duration, money, tokens } from "../lib/format";
import type { Phase } from "@shared/types";

export function Stage({ model, live }: { model: RunModel; live: RunModel }) {
  const runId = useStore((s) => s.selectedRunId)!;
  const toastMsg = useStore((s) => s.toastMsg);
  const [steer, setSteer] = useState("");
  const [showThinking, setShowThinking] = useState(true);
  const scrubbing = useStore((s) => s.scrubSeq) !== null;
  const feedRef = useAutoScroll<HTMLDivElement>(model.lastSeq, !scrubbing);
  const liveRun = isLive(live.status);
  const est = model.config?.engine === "claude-code";
  const [taskOpen, setTaskOpen] = useState(false);

  const sendSteer = async () => {
    const text = steer.trim();
    if (!text) return;
    try {
      await api.steer(runId, text);
      setSteer("");
    } catch (e) {
      toastMsg((e as Error).message, "error");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PhaseStepper model={model} />
      <div ref={feedRef} className="flex-1 overflow-auto px-4 py-3 relative">
        {feedRef.behind && liveRun && (
          <button className="btn btn-primary btn-sm sticky top-0 left-1/2 -translate-x-1/2 z-10 fade-in" onClick={feedRef.jump}>
            New activity ↓
          </button>
        )}
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {model.config && (
            <div className="card p-3.5 mb-1">
              <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-1">Task</div>
              <div className={`whitespace-pre-wrap leading-relaxed ${taskOpen ? "" : "line-clamp-4"}`}>{model.config.task}</div>
              {model.config.task.length > 280 && (
                <button className="btn btn-ghost btn-sm mt-1" onClick={() => setTaskOpen(!taskOpen)}>
                  {taskOpen ? "Show less" : "Show all"}
                </button>
              )}
            </div>
          )}
          {model.feed.length === 0 && <div className="muted text-center py-10">Waiting for the first event…</div>}
          {model.feed.map((item) => (
            <FeedRow key={item.seq} item={item} model={model} showThinking={showThinking} />
          ))}
          {(scrubbing ? model : live).pending.map((p) => (
            <ApprovalCard key={p.approvalId} request={p} runId={runId} disabled={scrubbing} />
          ))}
          {model.status === "paused" && <div className="text-center muted text-[12px] py-2">Paused. The agent will continue when you resume.</div>}
          {!liveRun && model.config && <EndCard model={model} est={est} />}
        </div>
      </div>
      <div className="border-t line px-4 py-2.5" style={{ background: "var(--bg-elev)" }}>
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] muted shrink-0 cursor-pointer">
            <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} /> thinking
          </label>
          <input
            className="input"
            placeholder={liveRun ? "Leave the agent a note… (delivered before its next step)" : "This run is over. Start a new one to steer."}
            disabled={!liveRun}
            value={steer}
            onChange={(e) => setSteer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && sendSteer()}
            aria-label="Note to the agent"
          />
          <button className="btn btn-primary" disabled={!liveRun || !steer.trim()} onClick={sendSteer}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/** How the run ended, always, with a next step. A failed run that never said why is the worst outcome. */
function EndCard({ model, est }: { model: RunModel; est: boolean }) {
  const status = model.status;
  const reason = model.summary?.summary ?? model.statusReason ?? model.errors[model.errors.length - 1] ?? "";
  const tone = status === "completed" ? "var(--ok)" : status === "cancelled" ? "var(--line-strong)" : "var(--bad)";
  const title = status === "completed" ? "Run complete" : status === "cancelled" ? "Run stopped" : status === "failed" ? "Run failed" : `Run ${status}`;
  const interrupted = /interrupted|restart/i.test(reason);
  const budget = /budget/i.test(reason);
  const next = status === "completed" ? "Review the files and the evaluator's evidence on the Contract tab. Use Run again to see whether it passes consistently." : interrupted ? "Use Run again to retry; progress notes in .reins/ carry over to the next session." : budget ? "Raise the budget in New run (Run again keeps every other setting)." : status === "cancelled" ? "Files the agent already changed are still in the workspace; check the Files tab." : "Read the last turns above and the Guardrails tab; then use Run again, possibly with a component turned off on the Harness tab.";
  const cost = model.summary?.costUsd ?? model.costUsd;
  const dur = model.summary?.durationMs ?? (model.startedTs && model.lastTs ? Date.parse(model.lastTs) - Date.parse(model.startedTs) : 0);
  return (
    <div className="card p-4 border-l-4 fade-in" style={{ borderLeftColor: tone }} role="status">
      <div className="font-semibold">{title}</div>
      {reason && <div className="mt-1 leading-relaxed">{reason}</div>}
      <div className="muted text-[12.5px] mt-2">{next}</div>
      <div className="muted text-[12px] mt-2 mono">
        {est ? "est. " : ""}
        {money(cost)} · {duration(dur)} · {model.calls.length} tool calls
      </div>
    </div>
  );
}

function PhaseStepper({ model }: { model: RunModel }) {
  const cfg = model.config;
  const enabled = PHASE_ORDER.filter((p) => (p === "plan" ? cfg?.components.planner !== false : p === "contract" ? cfg?.components.contracts !== false : p === "evaluate" ? cfg?.components.evaluator !== false : true));
  const latestByPhase = new Map<Phase, RunModel["phases"][number]>();
  for (const p of model.phases) latestByPhase.set(p.phase, p);
  const rounds = model.phases.filter((p) => p.phase === "build").length;
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b line overflow-x-auto" style={{ background: "var(--bg-elev)" }}>
      {enabled.map((p, i) => {
        const stat = latestByPhase.get(p);
        const state = !stat ? "todo" : stat.finishedTs ? "done" : "active";
        return (
          <React.Fragment key={p}>
            {i > 0 && <span className="faint">›</span>}
            <div
              className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-[12.5px] ${state === "active" ? "sunk font-semibold" : state === "done" ? "" : "faint"}`}
              title={stat?.summary}
            >
              <span className={`w-2 h-2 rounded-full ${state === "done" ? "bg-[var(--ok)]" : state === "active" ? "bg-[var(--accent)] pulse" : "bg-[var(--line-strong)]"}`} />
              {PHASE_LABEL[p]}
              {p === "build" && rounds > 1 && <span className="badge badge-neutral">×{rounds}</span>}
              {stat && <span className="muted mono text-[11px]">{money(stat.costUsd)}</span>}
            </div>
          </React.Fragment>
        );
      })}
      {model.evaluations.length > 0 && (
        <>
          <span className="flex-1" />
          <Badge tone={model.evaluations[model.evaluations.length - 1].verdict === "pass" ? "ok" : "bad"}>
            last evaluation: {model.evaluations[model.evaluations.length - 1].verdict}
          </Badge>
        </>
      )}
    </div>
  );
}

function FeedRow({ item, model, showThinking }: { item: FeedItem; model: RunModel; showThinking: boolean }) {
  switch (item.kind) {
    case "phase":
      return (
        <div className="flex items-center gap-3 pt-4 pb-1 fade-in">
          <div className="h-px flex-1 line border-t" />
          <div className="text-[11px] uppercase tracking-wider font-semibold muted">
            {PHASE_LABEL[item.phase]}
            {item.round > 1 ? ` · round ${item.round}` : ""}
            {item.finished && <span className="normal-case tracking-normal font-normal"> — {item.finished.summary}</span>}
          </div>
          <div className="h-px flex-1 line border-t" />
        </div>
      );
    case "turn":
      return <TurnRow item={item} showThinking={showThinking} />;
    case "approval":
      if (!item.resolved) return null; // the live ApprovalCard renders the pending one
      return (
        <div className="card p-3 border-l-4 fade-in" style={{ borderLeftColor: item.resolved ? (item.resolved.decision === "approve" ? "var(--ok)" : "var(--bad)") : "var(--warn)" }}>
          <div className="flex items-center gap-2 text-[12px]">
            <Badge tone={item.resolved ? (item.resolved.decision === "approve" ? "ok" : "bad") : "warn"}>{item.resolved ? item.resolved.decision + "d" : "waiting for you"}</Badge>
            <span className="font-medium">{item.request.title}</span>
            <span className="flex-1" />
            <span className="faint mono">{clock(item.ts)}</span>
          </div>
          {item.resolved?.note && <div className="muted text-[12px] mt-1">Note: {item.resolved.note}</div>}
        </div>
      );
    case "contract":
      return (
        <div className="card p-3 fade-in">
          <div className="flex items-center gap-2 text-[12px] mb-2">
            {item.by === "agreed" ? <Badge tone="ok">contract agreed</Badge> : <RoleChip role={item.by} />}
            <span className="muted">{item.by === "agreed" ? `${item.criteria.length} criteria` : item.by === "builder" ? "proposed a definition of done" : "reviewed the contract"}</span>
            <span className="flex-1" />
            <span className="faint mono">{clock(item.ts)}</span>
          </div>
          {item.rationale && <div className="text-[12.5px] mb-2 leading-relaxed">{item.rationale}</div>}
          <ul className="flex flex-col gap-1">
            {item.criteria.map((c) => (
              <li key={c.id} className="text-[12.5px] flex gap-2">
                <span className="mono faint w-6 shrink-0">{c.id}</span>
                <span>
                  {c.text}
                  {c.hard && <span className="badge badge-neutral ml-1.5">hard</span>}
                  <div className="muted text-[11.5px] mono mt-0.5">verify: {c.verify}</div>
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "evaluation":
      return (
        <div className="card p-3 border-l-4 fade-in" style={{ borderLeftColor: item.verdict === "pass" ? "var(--ok)" : "var(--bad)" }}>
          <div className="flex items-center gap-2 text-[12px] mb-1.5">
            <RoleChip role="evaluator" />
            <Badge tone={item.verdict === "pass" ? "ok" : "bad"}>
              round {item.round}: {item.verdict}
            </Badge>
            <span className="muted">
              {item.results.filter((r) => r.pass).length}/{item.results.length} criteria pass
            </span>
            <span className="flex-1" />
            <span className="faint mono">{clock(item.ts)}</span>
          </div>
          <div className="text-[12.5px] leading-relaxed">{item.summary}</div>
          {item.results.some((r) => !r.pass) && (
            <ul className="mt-2 flex flex-col gap-1">
              {item.results
                .filter((r) => !r.pass)
                .map((r) => (
                  <li key={r.id} className="text-[12px] flex gap-2">
                    <span className="text-[var(--bad)] font-bold shrink-0">✕ {r.id}</span>
                    <span className="muted">{r.evidence}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      );
    case "context":
      return (
        <div className="flex items-start gap-2 text-[12px] muted px-1 py-1 fade-in">
          <span className="shrink-0">{item.what === "compacted" ? "⤓" : item.what === "cleared" ? "⌫" : "↻"}</span>
          <span>
            <span className={`font-medium role-${item.role}`}>{item.role}</span> context {item.what}.{" "}
            {item.what === "cleared" ? item.detail : <Collapsible summary={item.what === "reset" ? "handoff note" : "summary"} className="inline-block">{<Pre>{item.detail}</Pre>}</Collapsible>}
          </span>
        </div>
      );
    case "steer":
      return (
        <div className="flex justify-end fade-in">
          <div className="rounded-xl px-3 py-2 max-w-[80%] text-[12.5px]" style={{ background: "var(--accent-soft)" }}>
            <div className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: "var(--accent)" }}>
              you · {item.delivered ? "delivered" : "queued for the next step"}
            </div>
            {item.text}
          </div>
        </div>
      );
    case "commit":
      return (
        <div className="flex items-center gap-2 text-[12px] muted px-1 fade-in">
          <span>⎇</span>
          <span className="mono">{item.sha}</span>
          <span className="truncate">{item.message}</span>
          <span className="faint">· {item.files} files</span>
        </div>
      );
    case "note":
      if (item.level === "info" && item.text.length > 160)
        return (
          <Collapsible summary={<span className="muted">{item.text.slice(0, 110)}…</span>} className="px-2 py-1 text-[12px]">
            <div className="muted whitespace-pre-wrap">{item.text}</div>
          </Collapsible>
        );
      return (
        <div className={`text-[12px] px-2 py-1.5 rounded-md fade-in ${item.level === "error" ? "badge-bad" : item.level === "warn" ? "badge-warn" : "muted"}`} style={item.level === "info" ? undefined : { background: item.level === "error" ? "var(--bad-soft)" : "var(--warn-soft)" }}>
          {item.text}
        </div>
      );
    case "summary":
      return null;
  }
}

function TurnRow({ item, showThinking }: { item: Extract<FeedItem, { kind: "turn" }>; showThinking: boolean }) {
  const [open, setOpen] = useState(false);
  const hasBody = !!item.text || item.calls.length > 0 || (showThinking && item.thinking);
  if (!hasBody && !item.usage) return null;
  return (
    <div className="flex gap-3 fade-in">
      <div className={`w-1 rounded-full shrink-0 bg-role-${item.role}`} style={{ opacity: 0.7 }} />
      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-2 text-[12px]">
          <RoleChip role={item.role} />
          {item.turn > 0 && <span className="faint">turn {item.turn}</span>}
          <span className="flex-1" />
          {item.usage && (
            <button className="faint mono hover:text-[var(--fg)]" onClick={() => setOpen(!open)} title="Prompt tokens / output tokens / cost for this turn">
              {tokens(item.usage.input + item.usage.cacheRead + item.usage.cacheWrite)} ▸ {tokens(item.usage.output)}
              {item.costUsd ? ` · ${money(item.costUsd)}` : ""}
            </button>
          )}
          <span className="faint mono">{clock(item.ts)}</span>
        </div>
        {showThinking && item.thinking && <div className="muted italic text-[12.5px] mt-1 leading-relaxed whitespace-pre-wrap">{item.thinking}</div>}
        {item.text && <div className="mt-1 leading-relaxed whitespace-pre-wrap">{item.text}</div>}
        {item.calls.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {item.calls.map((c) => (
              <CallRow key={c.toolUseId} call={c} />
            ))}
          </div>
        )}
        {open && item.usage && (
          <div className="mt-1 text-[11px] muted mono">
            input {tokens(item.usage.input)} · cache read {tokens(item.usage.cacheRead)} · cache write {tokens(item.usage.cacheWrite)} · output {tokens(item.usage.output)} · stop {item.stopReason}
          </div>
        )}
      </div>
    </div>
  );
}

export function CallRow({ call, expanded = false }: { call: ToolCall; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const g = call.guardrail;
  const pending = !call.result;
  return (
    <div className="rounded-lg border line overflow-hidden" style={{ background: "var(--bg-elev)" }}>
      <button className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 hover:bg-[var(--bg-sunk)]" onClick={() => setOpen(!open)}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${pending ? "bg-[var(--accent)] pulse" : call.result!.ok ? "bg-[var(--ok)]" : "bg-[var(--bad)]"}`} />
        <span className="text-[12.5px] truncate flex-1" dangerouslySetInnerHTML={{ __html: escape(call.narration).replace(/`([^`]+)`/g, "<code>$1</code>") }} />
        {g && g.verdict !== "allow" && (
          <Badge tone={g.verdict === "deny" ? "bad" : "warn"} title={g.rationale}>
            {g.verdict}
          </Badge>
        )}
        {g && g.source === "classifier" && (
          <Badge tone="neutral" title={g.rationale}>
            classifier
          </Badge>
        )}
        {g && g.source === "user" && (
          <Badge tone={g.verdict === "allow" ? "ok" : "bad"} title={g.rationale}>
            you {g.verdict === "allow" ? "approved" : "declined"}
          </Badge>
        )}
        {call.result && <span className="faint mono text-[11px]">{duration(call.result.durationMs)}</span>}
        <span className="faint text-[11px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 flex flex-col gap-2 fade-in border-t line pt-2">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-1">input · {call.name}</div>
            <Pre>{typeof call.input === "string" ? call.input : JSON.stringify(call.input, null, 2)}</Pre>
          </div>
          {g && (
            <div className="text-[12px] muted">
              Guardrail: <span className="font-medium">{g.verdict}</span> by {g.source} ({g.rule}). {g.rationale}
            </div>
          )}
          {call.result && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-1">
                {call.result.ok ? "result" : "error"}
                {call.result.truncated && " · truncated for the model"}
              </div>
              <Pre>{call.result.output}</Pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
