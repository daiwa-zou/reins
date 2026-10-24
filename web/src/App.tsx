import React, { useEffect, useMemo } from "react";
import { TABS, useStore } from "./state/store";
import { derive, isLive } from "./state/derive";
import { TopBar } from "./components/TopBar";
import { RunList } from "./components/RunList";
import { Inspector } from "./components/Inspector";
import { Stage } from "./panels/Stage";
import { Transcript } from "./panels/Transcript";
import { ContractPanel } from "./panels/Contract";
import { ContextPanel } from "./panels/Context";
import { GuardrailsPanel } from "./panels/Guardrails";
import { FilesPanel } from "./panels/Files";
import { HarnessPanel } from "./panels/Harness";
import { LessonsPanel } from "./panels/Lessons";
import { ReliabilityPanel } from "./panels/Reliability";
import { NewRun } from "./panels/NewRun";
import { Settings } from "./panels/Settings";
import { Welcome } from "./components/Welcome";
import { Help } from "./components/Help";
import { api } from "./lib/api";

export function App() {
  const boot = useStore((s) => s.boot);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const events = useStore((s) => (selectedRunId ? s.events[selectedRunId] : undefined));
  const scrubSeq = useStore((s) => s.scrubSeq);
  const modal = useStore((s) => s.modal);
  const openModal = useStore((s) => s.openModal);
  const toast = useStore((s) => s.toast);
  const toastMsg = useStore((s) => s.toastMsg);

  useEffect(() => {
    void boot();
  }, [boot]);

  const model = useMemo(() => derive(events ?? [], scrubSeq ?? Infinity), [events, scrubSeq]);
  const liveModel = useMemo(() => (scrubSeq === null ? model : derive(events ?? [])), [events, scrubSeq, model]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (modal) return;
      const tabHit = TABS.find((x) => x.key === e.key);
      if (tabHit) return setTab(tabHit.id);
      if (e.key === "n") return openModal("newRun");
      if (e.key === "d") {
        api.demo().then((cfg) => useStore.getState().selectRun(cfg.id)).catch((err) => toastMsg(err.message, "error"));
        return;
      }
      if (e.key === "?") return openModal("help");
      if (e.key === " " && selectedRunId && isLive(liveModel.status)) {
        e.preventDefault();
        const action = liveModel.status === "paused" ? api.resume : api.pause;
        action(selectedRunId).catch((err) => toastMsg(err.message, "error"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, selectedRunId, liveModel.status, setTab, openModal, toastMsg]);

  const Panel = { stage: Stage, transcript: Transcript, contract: ContractPanel, context: ContextPanel, guardrails: GuardrailsPanel, files: FilesPanel, harness: HarnessPanel, lessons: LessonsPanel, reliability: ReliabilityPanel }[tab];
  const standalone = tab === "lessons" || tab === "harness" || tab === "reliability";

  return (
    <div className="h-full flex flex-col">
      <TopBar model={liveModel} />
      <div className="flex-1 min-h-0 flex">
        <RunList />
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-1 px-3 pt-2 pb-1.5 border-b line overflow-x-auto" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)} title={`Press ${t.key}`}>
                {t.label}
                {t.id === "stage" && liveModel.pending.length > 0 && <span className="badge badge-warn">{liveModel.pending.length}</span>}
                {t.id === "contract" && liveModel.evaluations.length > 0 && (
                  <span className={`badge ${liveModel.evaluations[liveModel.evaluations.length - 1].verdict === "pass" ? "badge-ok" : "badge-bad"}`}>{liveModel.evaluations[liveModel.evaluations.length - 1].verdict}</span>
                )}
              </button>
            ))}
            <div className="flex-1" />
            {scrubSeq !== null && (
              <button className="btn btn-sm" onClick={() => useStore.getState().setScrub(null)}>
                ⏮ Viewing seq {scrubSeq} · back to live
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">{!selectedRunId && !standalone ? <Welcome /> : <Panel model={model} live={liveModel} />}</div>
        </main>
        {selectedRunId && !standalone && <Inspector model={model} live={liveModel} />}
      </div>
      {modal === "newRun" && <NewRun />}
      {modal === "settings" && <Settings />}
      {modal === "help" && <Help />}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 card px-4 py-2 fade-in z-50 ${toast.kind === "error" ? "text-[var(--bad)]" : ""}`} style={{ boxShadow: "var(--shadow)" }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
