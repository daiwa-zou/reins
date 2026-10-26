import React, { useState } from "react";
import { ArrowDown, Brain, ChevronDown, ChevronRight, Eraser, ExternalLink, GitCommitHorizontal, GitPullRequest, Hand, Minimize2, RefreshCw, Wrench } from "lucide-react";
import type { FeedItem, RunModel, ToolCall } from "../state/derive";
import { PHASE_LABEL, PHASE_ORDER, isLive } from "../state/derive";
import { groupCalls, summarizeNames } from "../state/feedGroups";
import { useStore } from "../state/store";
import { Badge, Collapsible, Pre, RoleChip, useAutoScroll } from "../components/ui";
import { ApprovalCard } from "../components/ApprovalCard";
import { api } from "../lib/api";
import { clock, duration, money, tokens } from "../lib/format";
import type { Phase, RoleId } from "@shared/types";
import { Elapsed, RunClockProvider, useRunClock } from "../lib/useNow";
import { runElapsed } from "../lib/time";

export function Stage({ model, live }: { model: RunModel; live: RunModel }) {
  const runId = useStore((s) => s.selectedRunId)!;
  const toastMsg = useStore((s) => s.toastMsg);
  const showThinking = useStore((s) => s.showThinking);
  const setShowThinking = useStore((s) => s.setShowThinking);
  const [steer, setSteer] = useState("");
  const scrubbing = useStore((s) => s.scrubSeq) !== null;
  const feedRef = useAutoScroll<HTMLDivElement>(model.lastSeq, !scrubbing);
  const liveRun = isLive(live.status);
  const [taskOpen, setTaskOpen] = useState(false);
  const pending = (scrubbing ? model : live).pending;

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
  const jumpToApproval = () => {
    const el = document.getElementById(`approval-${pending[0]?.approvalId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    el.querySelector<HTMLElement>("textarea, input, button")?.focus({ preventScroll: true });
  };

  // Show the role chip only when the speaker changes, so a long builder phase is not a column of identical labels.
  let lastRole: RoleId | null = null;

  return (
    <RunClockProvider value={{ live: liveRun && !scrubbing, lastTs: model.lastTs }}>
    <div className="h-full flex flex-col">
      <PhaseStepper model={model} />
      {pending.length > 0 && (
        <button
          type="button"
          data-needs-you-banner
          onClick={jumpToApproval}
          className="flex items-center gap-2 px-4 py-2 text-left border-b fade-in shrink-0"
          style={{ background: "var(--warn-soft)", color: "var(--warn)", borderColor: "color-mix(in srgb, var(--warn) 35%, transparent)" }}
        >
          <Hand size={15} aria-hidden className="pulse" />
          <span className="font-semibold">Needs you</span>
          <span className="truncate min-w-0" style={{ color: "var(--fg)" }}>
            {pending[0].title}
            {pending.length > 1 ? ` (+${pending.length - 1} more)` : ""}
          </span>
          <span className="flex-1" />
          <span className="text-small font-medium shrink-0 inline-flex items-center gap-1">
            Review <ArrowDown size={13} aria-hidden />
          </span>
        </button>
      )}
      <div ref={feedRef} className="flex-1 overflow-auto px-4 py-3 relative">
        {feedRef.behind && liveRun && (
          <button className="btn btn-primary btn-sm sticky top-0 left-1/2 -translate-x-1/2 z-10 fade-in" onClick={feedRef.jump}>
            New activity <ArrowDown size={13} aria-hidden />
          </button>
        )}
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {model.config && (
            <div className="mb-1 px-1">
              <div className="section-label mb-1">Task</div>
              <div className={`whitespace-pre-wrap leading-relaxed ${taskOpen ? "" : "line-clamp-3"}`}>{model.config.task}</div>
              {model.config.task.length > 220 && (
                <button className="btn btn-ghost btn-sm mt-1 -ml-2" onClick={() => setTaskOpen(!taskOpen)}>
                  {taskOpen ? "Show less" : "Show all"}
                </button>
              )}
            </div>
          )}
          {model.feed.length === 0 && <div className="muted text-center py-10">Waiting for the first event…</div>}
          {model.feed.map((item) => {
            let showRole = false;
            if (item.kind === "turn") {
              showRole = item.role !== lastRole;
              lastRole = item.role;
            } else if (item.kind === "phase") lastRole = null;
            return <FeedRow key={item.seq} item={item} model={model} showThinking={showThinking} showRole={showRole} />;
          })}
          {pending.map((p) => (
            <div key={p.approvalId} id={`approval-${p.approvalId}`} style={{ scrollMarginTop: 12 }}>
              <ApprovalCard request={p} runId={runId} disabled={scrubbing} />
            </div>
          ))}
          {model.status === "paused" && <div className="text-center muted text-small py-2">Paused. The agent will continue when you resume.</div>}
          {!liveRun && model.config && <EndCard model={model} />}
        </div>
      </div>
      <div className="border-t line px-4 py-2" style={{ background: "var(--bg-elev)" }}>
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button
            type="button"
            className="icon-btn"
            aria-pressed={showThinking}
            onClick={() => setShowThinking(!showThinking)}
            aria-label={showThinking ? "Hide the model's thinking" : "Show the model's thinking"}
            title={showThinking ? "Thinking shown (click to hide)" : "Thinking hidden (click to show)"}
          >
            <Brain size={15} aria-hidden />
          </button>
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
    </RunClockProvider>
  );
}

/** How the run ended, always, with a next step. A failed run that never said why is the worst outcome. */
function EndCard({ model }: { model: RunModel }) {
  const status = model.status;
  const reason = model.summary?.summary ?? model.statusReason ?? model.errors[model.errors.length - 1] ?? "";
  const tone = status === "completed" ? "var(--ok)" : status === "cancelled" ? "var(--line-strong)" : "var(--bad)";
  const title = status === "completed" ? "Run complete" : status === "cancelled" ? "Run stopped" : status === "failed" ? "Run failed" : `Run ${status}`;
  const interrupted = /interrupted|restart/i.test(reason);
  const budget = /budget/i.test(reason);
  const turns = /ran out of turns/i.test(reason);
  const next =
    status === "completed"
      ? "Review the changes and the evaluator's evidence on the Contract tab. Use Run again to see whether it passes consistently."
      : interrupted
        ? "Use Run again to retry; progress notes in .reins/ carry over to the next session."
        : budget
          ? "Raise the budget in New run (Run again keeps every other setting)."
          : turns
            ? "Raise Max turns per phase in New run (Run again keeps every other setting), or agree a contract with fewer criteria; the Contract tab shows which criteria went unverified."
            : status === "cancelled"
              ? "Files the agent already changed are still in the workspace; check Changes."
              : "Read the last turns above and Details › Guardrails; then use Run again, possibly with a component turned off in Harness.";
  const dur = runElapsed(model, 0, false);
  return (
    <div className="card p-4 border-l-4 fade-in" style={{ borderLeftColor: tone }} role="status">
      <div className="font-semibold">{title}</div>
      {reason && <div className="mt-1 leading-relaxed">{reason}</div>}
      <div className="muted text-small mt-2">{next}</div>
      <div className="faint text-small mt-2 mono">
        {duration(dur)} · {model.calls.length} tool calls
      </div>
    </div>
  );
}

function PhaseStepper({ model }: { model: RunModel }) {
  const cfg = model.config;
  const enabled = PHASE_ORDER.filter((p) => (p === "plan" ? cfg?.components.planner !== false : p === "breakdown" ? cfg?.components.planner !== false && cfg?.components.workPackages === true : p === "contract" ? cfg?.components.contracts !== false : p === "tests" ? cfg?.components.testsFirst === true : p === "publish" ? cfg?.components.publish === true : p === "evaluate" ? cfg?.components.evaluator !== false : true));
  const latestByPhase = new Map<Phase, RunModel["phases"][number]>();
  for (const p of model.phases) latestByPhase.set(p.phase, p);
  const rounds = model.phases.filter((p) => p.phase === "build").length;
  const merged = [...model.pullRequests].reverse().find((pr) => pr.merged);
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b line overflow-x-auto text-small" aria-label="Phases">
      {enabled.map((p, i) => {
        const stat = latestByPhase.get(p);
        const state = !stat ? "todo" : stat.finishedTs ? "done" : "active";
        return (
          <React.Fragment key={p}>
            {i > 0 && <ChevronRight size={12} className="faint shrink-0" aria-hidden />}
            <div className="phase-pill" data-state={state} title={stat?.summary} aria-current={state === "active" ? "step" : undefined}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${state === "done" ? "bg-[var(--ok)]" : state === "active" ? "bg-[var(--accent)] pulse" : "bg-[var(--line-strong)]"}`} />
              {PHASE_LABEL[p]}
              {state === "active" && stat?.package && (
                <span className="font-normal">
                  · {stat.package.id} of {stat.package.total} · {stat.package.title}
                </span>
              )}
              {p === "build" && rounds > 1 && <span className="badge badge-neutral">×{rounds}</span>}
              {stat && <Elapsed start={stat.startedTs} end={stat.finishedTs} className="faint mono text-caption font-normal" title="Time in this phase" />}
            </div>
          </React.Fragment>
        );
      })}
      {merged && (
        <>
          <span className="flex-1" />
          <a className="faint text-caption whitespace-nowrap underline-offset-2 hover:underline" href={merged.url} target="_blank" rel="noreferrer" title={merged.branch}>
            {merged.package ? `package ${merged.package.id}` : "last package"} merged as #{merged.number}
          </a>
        </>
      )}
    </div>
  );
}

function FeedRow({ item, model, showThinking, showRole }: { item: FeedItem; model: RunModel; showThinking: boolean; showRole: boolean }) {
  switch (item.kind) {
    case "phase":
      return (
        <div className="flex items-center gap-3 pt-4 pb-1 fade-in">
          <div className="h-px flex-1 line border-t" />
          <div className="section-label" style={{ color: "var(--fg-muted)" }}>
            {PHASE_LABEL[item.phase]}
            {item.package ? ` · ${item.package.id} of ${item.package.total}: ${item.package.title}` : ""}
            {item.round > 1 ? ` · round ${item.round}` : ""}
            {item.finished && <span className="normal-case tracking-normal font-normal"> — {item.finished.summary}</span>}
          </div>
          <div className="h-px flex-1 line border-t" />
        </div>
      );
    case "turn":
      return <TurnRow item={item} showThinking={showThinking} showRole={showRole} />;
    case "approval":
      if (!item.resolved) return null; // the live ApprovalCard renders the pending one
      return (
        <div className="card px-3 py-2 border-l-4 fade-in" style={{ borderLeftColor: item.resolved.decision === "approve" ? "var(--ok)" : "var(--bad)" }}>
          <div className="flex items-center gap-2 text-small">
            <Badge tone={item.resolved.decision === "approve" ? "ok" : "bad"}>{item.resolved.decision + "d"}</Badge>
            <span className="font-medium">{item.request.title}</span>
          </div>
          {item.resolved.note && <div className="muted text-small mt-1">Note: {item.resolved.note}</div>}
        </div>
      );
    case "contract":
      return <ContractItem item={item} />;
    case "tests":
      return <TestsItem item={item} />;
    case "evaluation":
      return (
        <div className="card p-3 border-l-4 fade-in" style={{ borderLeftColor: item.verdict === "pass" ? "var(--ok)" : "var(--bad)" }}>
          <div className="flex items-center gap-2 text-small mb-1.5">
            <RoleChip role="evaluator" />
            <Badge tone={item.verdict === "pass" ? "ok" : "bad"}>
              round {item.round}: {item.verdict}
            </Badge>
            {item.origin && item.origin !== "reported" && (
              <Badge tone="warn" title={item.origin === "forced" ? "The evaluator ran out of turns and reported in a final forced call." : "The evaluator never reported; the harness wrote this report with every criterion unverified."}>
                {item.origin} report
              </Badge>
            )}
            <span className="muted">
              {item.results.filter((r) => r.pass).length}/{item.results.length} criteria pass
              {item.results.some((r) => r.unverified) ? `, ${item.results.filter((r) => r.unverified).length} unverified` : ""}
            </span>
          </div>
          <div className="leading-relaxed">{item.summary}</div>
          {item.results.some((r) => !r.pass) && (
            <ul className="mt-2 flex flex-col gap-1">
              {item.results
                .filter((r) => !r.pass)
                .map((r) => (
                  <li key={r.id} className="text-small flex gap-2">
                    <span className={`${r.unverified ? "text-[var(--warn)]" : "text-[var(--bad)]"} font-bold shrink-0`}>
                      {r.unverified ? "?" : "✕"} {r.id}
                    </span>
                    <span className="muted">{r.evidence}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      );
    case "context": {
      const Icon = item.what === "compacted" ? Minimize2 : item.what === "cleared" ? Eraser : RefreshCw;
      return (
        <div className="flex items-start gap-2 text-small muted px-1 py-1 fade-in">
          <Icon size={13} className="shrink-0 mt-0.5" aria-hidden />
          <span>
            <span className={`font-medium role-${item.role}`}>{item.role}</span> context {item.what}.{" "}
            {item.what === "cleared" ? item.detail : <Collapsible summary={item.what === "reset" ? "handoff note" : "summary"} className="inline-block">{<Pre>{item.detail}</Pre>}</Collapsible>}
          </span>
        </div>
      );
    }
    case "steer":
      return (
        <div className="flex justify-end fade-in">
          <div className="rounded-xl px-3 py-2 max-w-[80%]" style={{ background: "var(--accent-soft)" }}>
            <div className="section-label" style={{ color: "var(--accent)" }}>
              you · {item.delivered ? "delivered" : "queued for the next step"}
            </div>
            {item.text}
          </div>
        </div>
      );
    case "commit":
      return (
        <div className="flex items-center gap-2 text-small muted px-1 fade-in">
          <GitCommitHorizontal size={14} className="shrink-0" aria-hidden />
          <span className="mono">{item.sha}</span>
          <span className="truncate">{item.message}</span>
          <span className="faint">· {item.files} files</span>
        </div>
      );
    case "pr":
      return (
        <div className="flex items-center gap-2 text-small px-1 fade-in">
          <GitPullRequest size={14} className="shrink-0" style={{ color: item.what === "merged" ? "var(--ok)" : "var(--accent)" }} aria-hidden />
          <Badge tone={item.what === "merged" ? "ok" : item.what === "feedback" ? "warn" : "neutral"}>{item.what === "merged" ? "merged" : item.what === "feedback" ? `review round ${item.round}` : "pull request"}</Badge>
          <a className="underline underline-offset-2" href={item.url} target="_blank" rel="noreferrer">
            #{item.number}
          </a>
          {item.what === "feedback" ? (
            <span className="muted truncate">
              {item.comments} comment{item.comments === 1 ? "" : "s"}
              {item.checks?.length ? `, failing: ${item.checks.join(", ")}` : ""} — {item.summary}
            </span>
          ) : (
            <span className="mono muted truncate">
              {item.branch} → {item.base}
            </span>
          )}
          {item.package && <span className="faint truncate">· {item.package.id}: {item.package.title}</span>}
          {item.sha && <span className="mono faint">· {item.sha.slice(0, 7)}</span>}
        </div>
      );
    case "note":
      if (item.level === "info" && item.text.length > 160)
        return (
          <Collapsible summary={<span className="muted">{item.text.slice(0, 110)}…</span>} className="px-2 py-1 text-small">
            <div className="muted whitespace-pre-wrap">{item.text}</div>
          </Collapsible>
        );
      return (
        <div className={`text-small px-2 py-1.5 rounded-md fade-in ${item.level === "error" ? "badge-bad" : item.level === "warn" ? "badge-warn" : "muted"}`} style={item.level === "info" ? undefined : { background: item.level === "error" ? "var(--bad-soft)" : "var(--warn-soft)" }}>
          {item.text}
        </div>
      );
    case "summary":
      return null;
  }
}

/** A contract proposal or review: the criteria are one click away (the Contract tab has them in full). */
function ContractItem({ item }: { item: Extract<FeedItem, { kind: "contract" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card px-3 py-2 fade-in">
      <button type="button" className="w-full flex items-center gap-2 text-small text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {item.by === "agreed" ? <Badge tone="ok">contract agreed</Badge> : <RoleChip role={item.by} />}
        <span className="muted">{item.by === "agreed" ? `${item.criteria.length} criteria` : item.by === "builder" ? `proposed a definition of done · ${item.criteria.length} criteria` : `reviewed the contract · ${item.criteria.length} criteria`}</span>
        <span className="flex-1" />
        {open ? <ChevronDown size={14} className="faint" aria-hidden /> : <ChevronRight size={14} className="faint" aria-hidden />}
      </button>
      {item.rationale && <div className="text-small mt-1.5 leading-relaxed">{item.rationale}</div>}
      {open && (
        <ul className="flex flex-col gap-1 mt-2 fade-in">
          {item.criteria.map((c) => (
            <li key={c.id} className="text-small flex gap-2">
              <span className="mono faint w-6 shrink-0">{c.id}</span>
              <span>
                {c.text}
                {c.hard && <span className="badge badge-neutral ml-1.5">hard</span>}
                <div className="muted text-caption mono mt-0.5">verify: {c.verify}</div>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TestsItem({ item }: { item: Extract<FeedItem, { kind: "tests" }> }) {
  const [open, setOpen] = useState(false);
  const n = item.plan.tests.length;
  return (
    <div className="card px-3 py-2 fade-in">
      <button type="button" className="w-full flex items-center gap-2 text-small text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Badge tone="ok">tests written</Badge>
        <span className="muted">
          {n} test{n === 1 ? "" : "s"} · red before the build (exit {item.red.exitCode ?? "none"}) · <span className="mono">{item.plan.command}</span>
        </span>
        <span className="flex-1" />
        {open ? <ChevronDown size={14} className="faint" aria-hidden /> : <ChevronRight size={14} className="faint" aria-hidden />}
      </button>
      {item.plan.explanation && <div className="text-small mt-1.5 leading-relaxed">{item.plan.explanation}</div>}
      {open && (
        <ul className="flex flex-col gap-1 mt-2 fade-in">
          {item.plan.tests.map((t) => (
            <li key={t.id} className="text-small flex gap-2">
              <span className="mono faint w-6 shrink-0">{t.id}</span>
              <span>
                {t.name} <span className="badge badge-neutral ml-1">{t.kind}</span> <span className="mono faint text-caption">{t.criteria.join(", ")}</span>
                <div className="muted text-caption mt-0.5">{t.explains}</div>
                <div className="faint text-caption mono">{t.file}</div>
              </span>
            </li>
          ))}
          {item.plan.uncovered.map((u) => (
            <li key={u.id} className="text-small flex gap-2">
              <span className="mono faint w-6 shrink-0">{u.id}</span>
              <span className="muted">not covered by a test: {u.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TurnRow({ item, showThinking, showRole }: { item: Extract<FeedItem, { kind: "turn" }>; showThinking: boolean; showRole: boolean }) {
  const [open, setOpen] = useState(false);
  const runClock = useRunClock();
  const active = !item.finishedTs && runClock.live;
  const hasBody = !!item.text || item.calls.length > 0 || (showThinking && item.thinking) || active;
  if (!hasBody) return null;
  const entries = groupCalls(item.calls);
  return (
    <div className={`group relative flex gap-3 fade-in ${showRole ? "mt-1" : ""}`}>
      <div className={`w-1 rounded-full shrink-0 bg-role-${item.role}`} style={{ opacity: 0.6 }} />
      {/* Per-turn metadata: only on hover, keyboard focus or when expanded. */}
      <span
        className={`${open ? "inline-flex" : "hidden group-hover:inline-flex group-focus-within:inline-flex"} absolute right-0 -top-2.5 z-[1] items-center gap-2 faint mono text-caption rounded-md border line px-1.5 py-0.5`}
        style={{ background: "var(--bg-elev)", boxShadow: "var(--shadow)" }}
      >
        {item.turn > 0 && <span>turn {item.turn}</span>}
        {item.usage && (
          <button className="hover:text-[var(--fg)] hover:underline underline-offset-2" onClick={() => setOpen(!open)} title="Prompt tokens / output tokens / cost for this turn. Click for the breakdown." aria-expanded={open}>
            {tokens(item.usage.input + item.usage.cacheRead + item.usage.cacheWrite)} in · {tokens(item.usage.output)} out
            {item.costUsd ? ` · ${money(item.costUsd)}` : ""}
          </button>
        )}
        <span>{clock(item.ts)}</span>
        <Elapsed start={item.ts} end={item.finishedTs} className="" title="Turn time" />
      </span>
      <div className="flex-1 min-w-0 py-0.5">
        {(showRole || active) && (
          <div className="flex items-center gap-2 text-small">
            {showRole && <RoleChip role={item.role} />}
            {active && (
              <span className="faint text-caption" data-active-turn>
                working · <Elapsed start={item.ts} end={item.finishedTs} className="mono" title="Time in this turn" />
              </span>
            )}
          </div>
        )}
        {showThinking && item.thinking && <div className="muted italic mt-1 leading-relaxed whitespace-pre-wrap">{item.thinking}</div>}
        {item.text && <div className="mt-1 leading-relaxed whitespace-pre-wrap">{item.text}</div>}
        {entries.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {entries.map((e) => (e.kind === "call" ? <CallRow key={e.call.toolUseId} call={e.call} /> : <CallGroup key={e.calls[0].toolUseId} calls={e.calls} />))}
          </div>
        )}
        {open && item.usage && (
          <div className="mt-1 text-caption muted mono">
            input {tokens(item.usage.input)} · cache read {tokens(item.usage.cacheRead)} · cache write {tokens(item.usage.cacheWrite)} · output {tokens(item.usage.output)} · stop {item.stopReason}
          </div>
        )}
      </div>
    </div>
  );
}

/** Consecutive successful calls, collapsed. Failed and flagged calls are never in here (see feedGroups.ts). */
function CallGroup({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const total = calls.reduce((a, c) => a + (c.result?.durationMs ?? 0), 0);
  return (
    <div data-call-group>
      <button type="button" className="w-full text-left flex items-center gap-2 px-2.5 py-1 rounded-lg hover:bg-[var(--bg-sunk)] text-small muted" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Wrench size={13} className="shrink-0" aria-hidden />
        <span className="font-medium" style={{ color: "var(--fg)" }}>
          {calls.length} tool calls
        </span>
        <span className="truncate flex-1 min-w-0 mono text-caption">{summarizeNames(calls)}</span>
        <span className="faint mono text-caption shrink-0">{duration(total)}</span>
        {open ? <ChevronDown size={14} className="faint shrink-0" aria-hidden /> : <ChevronRight size={14} className="faint shrink-0" aria-hidden />}
      </button>
      {open && (
        <div className="mt-1 ml-3 pl-2 border-l line flex flex-col gap-1 fade-in">
          {calls.map((c) => (
            <CallRow key={c.toolUseId} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CallRow({ call, expanded = false }: { call: ToolCall; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const g = call.guardrail;
  const pending = !call.result;
  return (
    <div className="rounded-lg border line overflow-hidden" style={{ background: "var(--bg-elev)" }}>
      <button className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 hover:bg-[var(--bg-sunk)]" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${pending ? "bg-[var(--accent)] pulse" : call.result!.ok ? "bg-[var(--ok)]" : "bg-[var(--bad)]"}`} aria-label={pending ? "running" : call.result!.ok ? "succeeded" : "failed"} />
        <span className="text-small truncate flex-1" dangerouslySetInnerHTML={{ __html: escape(call.narration).replace(/`([^`]+)`/g, "<code>$1</code>") }} />
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
        <Elapsed start={call.ts} fixedMs={call.result?.durationMs} title={pending ? "Running for" : "Took"} />
        {open ? <ChevronDown size={14} className="faint shrink-0" aria-hidden /> : <ChevronRight size={14} className="faint shrink-0" aria-hidden />}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 flex flex-col gap-2 fade-in border-t line pt-2">
          <div>
            <div className="section-label mb-1">input · {call.name}</div>
            <Pre>{typeof call.input === "string" ? call.input : JSON.stringify(call.input, null, 2)}</Pre>
          </div>
          {g && (
            <div className="text-small muted">
              Guardrail: <span className="font-medium">{g.verdict}</span> by {g.source} ({g.rule}). {g.rationale}
            </div>
          )}
          {call.result && (
            <div>
              <div className="section-label mb-1 flex items-center gap-2">
                {call.result.ok ? "result" : "error"}
                {call.result.truncated && (
                  <>
                    <span>· truncated for the model</span>
                    <a className="underline normal-case tracking-normal inline-flex items-center gap-0.5" href={`/api/runs/${useStore.getState().selectedRunId}/tool-output/${call.toolUseId}`} target="_blank" rel="noreferrer">
                      full output <ExternalLink size={11} aria-hidden />
                    </a>
                  </>
                )}
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
