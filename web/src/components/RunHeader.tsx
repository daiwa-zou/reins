import React from "react";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { useStore } from "../state/store";
import type { RunModel } from "../state/derive";
import { isLive } from "../state/derive";
import { StatusBadge } from "./ui";
import { api } from "../lib/api";
import { money, duration, tilde, nextTitle } from "../lib/format";
import { budgetProgress } from "../state/budget";
import { useNow } from "../lib/useNow";
import { runElapsed } from "../lib/time";
import { runChipLabel } from "@shared/presets";
import { runPresetChip } from "../state/runChip";

/** Identity and controls of the selected run: the only place its cost and status sit in the chrome. */
/** `at` is the scrubbed model while rewinding: the elapsed time is shown at that point, static. */
export function RunHeader({ model, at }: { model: RunModel; at?: RunModel }) {
  const info = useStore((s) => s.info);
  const openModal = useStore((s) => s.openModal);
  const toastMsg = useStore((s) => s.toastMsg);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const availableEngine = useStore((s) => s.availableEngine);
  const cfg = model.config;
  const live = isLive(model.status);
  const scrubbing = useStore((s) => s.scrubSeq) !== null;
  // Ticks only while the run is live and we are looking at "now"; a scrub point is static.
  const ticking = live && !scrubbing;
  const now = useNow(ticking);
  const [pendingAction, setPendingAction] = React.useState<"stopping" | "pausing" | "resuming" | null>(null);
  React.useEffect(() => setPendingAction(null), [model.status]);
  if (!cfg) return null;

  const act = (fn: (id: string) => Promise<unknown>, label: "stopping" | "pausing" | "resuming") => () => {
    if (!selectedRunId) return;
    setPendingAction(label);
    fn(selectedRunId).catch((e) => {
      setPendingAction(null);
      toastMsg(e.message, "error");
    });
  };
  // While scrubbing: the time at the scrub point (its last event), never ticking.
  const elapsed = scrubbing && at ? runElapsed({ startedTs: at.startedTs, lastTs: at.lastTs }, now, false) : runElapsed(model, now, ticking);
  const est = cfg.engine === "claude-code";

  return (
    <div data-run-header className="flex items-center gap-3 px-4 pt-3 pb-1 min-w-0 overflow-hidden">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate font-semibold text-title min-w-0" title={`${cfg.task}\n\n${cfg.roles.builder.model} · effort ${cfg.roles.builder.effort}`}>
            {cfg.title}
          </h1>
          <span className="shrink-0" title={model.statusReason ?? undefined}>
            <StatusBadge status={model.status} />
          </span>
          {runPresetChip(cfg) && (
            <span className="badge badge-accent shrink-0" data-preset-chip title={cfg.effort ? `Effort · Supervision · domains in the order layered: ${runChipLabel(cfg)}` : cfg.presets?.length ? `Presets (before Effort and Supervision): ${runChipLabel(cfg)}` : cfg.job === "intake" ? "A lesson intake job, not a run" : `Preset: ${cfg.preset}`}>
              {runPresetChip(cfg)}
            </span>
          )}
          {cfg.engine === "replay" && <span className="badge badge-neutral shrink-0">recorded demo</span>}
        </div>
        <div className="flex items-center gap-2 text-small muted min-w-0 mt-0.5">
          <span className="truncate min-w-0" title={cfg.workspace}>
            {tilde(cfg.workspace, info?.home)}
          </span>
          <span className="faint shrink-0" aria-hidden>
            ·
          </span>
          <span className="mono shrink-0" title="Elapsed">
            {duration(elapsed)}
          </span>
          <span className="faint shrink-0" aria-hidden>
            ·
          </span>
          <BudgetInline model={model} est={est} />
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {live && (
          <>
            {model.status === "paused" ? (
              <button className="btn btn-sm" onClick={act(api.resume, "resuming")} disabled={!!pendingAction} title="Resume (space)">
                <Play size={13} aria-hidden /> {pendingAction === "resuming" ? "Resuming…" : "Resume"}
              </button>
            ) : (
              <button className="btn btn-sm" onClick={act(api.pause, "pausing")} disabled={!!pendingAction} title="Pause: the agent finishes its current step, then waits (space)">
                <Pause size={13} aria-hidden /> {pendingAction === "pausing" ? "Pausing…" : "Pause"}
              </button>
            )}
            <button
              className="btn btn-sm btn-danger"
              disabled={!!pendingAction}
              title="Stop this run"
              onClick={() => confirm("Stop this run? The agent is interrupted after its current tool call; files it already changed stay in the workspace.") && act(api.cancel, "stopping")()}
            >
              <Square size={12} aria-hidden /> {pendingAction === "stopping" ? "Stopping…" : "Stop"}
            </button>
          </>
        )}
        {!live && (
          <button
            className="btn btn-sm"
            onClick={() => openModal("newRun", { ...cfg, id: undefined, createdAt: undefined, title: nextTitle(cfg.title), engine: cfg.engine === "replay" ? availableEngine() : cfg.engine })}
            title="Start a new run with the same task and settings. Repeated runs show up together in Reliability."
          >
            <RotateCcw size={13} aria-hidden /> Run again
          </button>
        )}
      </div>
    </div>
  );
}

/** The budget as a slim gauge in the engine's unit, with the list-price figure beside it (an estimate on a subscription). */
function BudgetInline({ model, est }: { model: RunModel; est: boolean }) {
  const b = budgetProgress(model.config!, model);
  // A run from before the token budget has no cap on record: say what it spent, without a gauge against a cap it never had.
  if (!b.recorded)
    return (
      <span className="inline-flex items-center gap-2 shrink-0" title="This run predates the token budget, so no cap was recorded or enforced for it" data-budget-inline>
        <span className="mono">{b.fmt(b.spent)} tokens spent</span>
        <span className="faint">· no cap recorded · ≈ {money(model.costUsd)} at list price, not billed</span>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 shrink-0" title={b.kind === "tokens" ? "This run's budget: tokens counted against the subscription (cache reads at a tenth) against the cap set for it; the run stops at the cap" : "This run's budget: spent of its dollar cap; the run stops at the cap"} data-budget-inline>
      <span className="faint">budget</span>
      <span className="inline-block w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-sunk)" }} aria-hidden>
        <span className="block h-full" style={{ width: `${Math.round(b.frac * 100)}%`, background: `var(--${b.tone})` }} />
      </span>
      <span className="mono">
        {b.fmt(b.spent)} of {b.fmt(b.limit)}
        {b.kind === "tokens" ? " tokens" : ""}
      </span>
      {est && <span className="faint">≈ {money(model.costUsd)} at list price, not billed</span>}
    </span>
  );
}
