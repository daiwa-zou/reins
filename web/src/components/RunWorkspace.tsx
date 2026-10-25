import { rovingTabs } from "./ui";
import React, { useState } from "react";
import { History, PanelRightClose, PanelRightOpen, Radio } from "lucide-react";
import type { RunModel } from "../state/derive";
import { useStore, RUN_VIEWS } from "../state/store";
import { keyForView } from "../state/nav";
import { RunHeader } from "./RunHeader";
import { Overview } from "./Overview";
import { Stage } from "../panels/Stage";
import { ContractPanel } from "../panels/Contract";
import { FilesPanel } from "../panels/Files";
import { DetailsPanel } from "../panels/Details";

/** Everything about the selected run: header, run-view tabs, the view, and the Overview rail. */
export function RunWorkspace({ model, live }: { model: RunModel; live: RunModel }) {
  const view = useStore((s) => s.view);
  const navigate = useStore((s) => s.navigate);
  const overviewOpen = useStore((s) => s.overviewOpen);
  const setOverviewOpen = useStore((s) => s.setOverviewOpen);
  const scrubSeq = useStore((s) => s.scrubSeq);
  const [rewindOpen, setRewindOpen] = useState(false);
  const latestEval = live.evaluations[live.evaluations.length - 1];

  const panel =
    view === "activity" ? <Stage model={model} live={live} /> : view === "contract" ? <ContractPanel model={model} /> : view === "changes" ? <FilesPanel model={model} /> : <DetailsPanel model={model} live={live} />;

  return (
    <div className="h-full flex min-w-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <RunHeader model={live} at={scrubSeq !== null ? model : undefined} />
        <div className="flex items-end gap-2 px-4 border-b line min-w-0">
          <div role="tablist" aria-label="Run views" className="flex items-end min-w-0 overflow-x-auto" onKeyDown={(e) => rovingTabs(e, RUN_VIEWS.map((t) => t.id), view, (id) => navigate({ section: "runs", view: id as typeof view }))}>
            {RUN_VIEWS.map((t) => (
              <button key={t.id} role="tab" aria-selected={view === t.id} tabIndex={view === t.id ? 0 : -1} id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} className="view-tab" onClick={() => navigate({ section: "runs", view: t.id })} title={`${t.label} (${keyForView(t.id)})`}>
                {t.label}
                {t.id === "activity" && live.pending.length > 0 && (
                  <span className="badge badge-warn" title="Waiting for you">
                    {live.pending.length}
                  </span>
                )}
                {t.id === "contract" && latestEval && (
                  <span className={`badge ${latestEval.verdict === "pass" ? "badge-ok" : "badge-bad"}`} title={`Last evaluation, round ${latestEval.round}`}>
                    {latestEval.verdict}
                  </span>
                )}
                {t.id === "changes" && live.files.length > 0 && <span className="faint mono text-caption">{live.files.length}</span>}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 pb-1 shrink-0">
            <button className="icon-btn" aria-pressed={rewindOpen || scrubSeq !== null} onClick={() => setRewindOpen(!rewindOpen)} aria-label="Rewind: scrub back through the run" title="Rewind: scrub back through the run">
              <History size={15} aria-hidden />
            </button>
            <button className="icon-btn" aria-pressed={overviewOpen} onClick={() => setOverviewOpen(!overviewOpen)} aria-label={overviewOpen ? "Hide the overview" : "Show the overview"} title={overviewOpen ? "Hide the overview" : "Show the overview (progress and budget)"}>
              {overviewOpen ? <PanelRightClose size={15} aria-hidden /> : <PanelRightOpen size={15} aria-hidden />}
            </button>
          </div>
        </div>
        {(rewindOpen || scrubSeq !== null) && <Scrubber onClose={() => setRewindOpen(false)} />}
        <div className="flex-1 min-h-0 overflow-hidden" role="tabpanel" aria-label={RUN_VIEWS.find((v) => v.id === view)?.label}>
          {panel}
        </div>
      </div>
      {overviewOpen && <Overview model={model} live={live} />}
    </div>
  );
}

/** Rewind the whole run UI to any event. Every run view shows the state as of that point. */
function Scrubber({ onClose }: { onClose: () => void }) {
  const runId = useStore((s) => s.selectedRunId)!;
  const events = useStore((s) => s.events[runId]);
  const scrubSeq = useStore((s) => s.scrubSeq);
  const setScrub = useStore((s) => s.setScrub);
  const maxSeq = events?.length ? events[events.length - 1].seq : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b line fade-in" style={{ background: scrubSeq !== null ? "var(--accent-soft)" : "var(--bg-elev)" }}>
      <span className="text-small font-medium shrink-0">{scrubSeq !== null ? "Rewound" : "Rewind"}</span>
      <input
        type="range"
        min={0}
        max={maxSeq}
        value={scrubSeq ?? maxSeq}
        onChange={(e) => setScrub(Number(e.target.value) >= maxSeq ? null : Number(e.target.value))}
        className="flex-1 min-w-0 accent-[var(--accent)]"
        aria-label="Scrub through the run"
      />
      <span className="text-caption muted mono shrink-0">
        event {scrubSeq ?? maxSeq} / {maxSeq}
      </span>
      <button
        className="btn btn-sm shrink-0"
        onClick={() => {
          setScrub(null);
          onClose();
        }}
        title="Back to the live state"
      >
        <Radio size={13} aria-hidden /> {scrubSeq !== null ? "Back to live" : "Close"}
      </button>
    </div>
  );
}
