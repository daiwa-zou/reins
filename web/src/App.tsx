import React, { useEffect, useMemo } from "react";
import { useStore } from "./state/store";
import { derive, isLive } from "./state/derive";
import { applyNavAction, shortcutFor } from "./state/nav";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { RunWorkspace } from "./components/RunWorkspace";
import { HarnessPanel } from "./panels/Harness";
import { LessonsPanel } from "./panels/Lessons";
import { ReliabilityPanel } from "./panels/Reliability";
import { NewRun } from "./panels/NewRun";
import { Settings } from "./panels/Settings";
import { Welcome } from "./components/Welcome";
import { Help } from "./components/Help";
import { api } from "./lib/api";
import { startDemo } from "./lib/demo";

/** Typing never triggers shortcuts. */
function isTextEntry(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
/** Space and Enter activate a focused control, so they are left to it. */
function isControl(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "BUTTON" || el.tagName === "A" || !!el.closest?.("[role=button],[role=tab],[role=switch],[role=menuitem],[role=menuitemradio]");
}

export function App() {
  const boot = useStore((s) => s.boot);
  const section = useStore((s) => s.section);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const events = useStore((s) => (selectedRunId ? s.events[selectedRunId] : undefined));
  const scrubSeq = useStore((s) => s.scrubSeq);
  const modal = useStore((s) => s.modal);
  const openModal = useStore((s) => s.openModal);
  const toast = useStore((s) => s.toast);
  const toastMsg = useStore((s) => s.toastMsg);
  const bootError = useStore((s) => s.bootError);
  const booting = useStore((s) => s.booting);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Back/forward: the URL is the source of truth for where you are.
  useEffect(() => {
    const onPop = () => useStore.getState().syncFromUrl();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const model = useMemo(() => derive(events ?? [], scrubSeq ?? Infinity), [events, scrubSeq]);
  const liveModel = useMemo(() => (scrubSeq === null ? model : derive(events ?? [])), [events, scrubSeq, model]);

  // Keyboard shortcuts: bound from the one map in nav.ts (Help lists the same map).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (isTextEntry(e.target)) return;
      if (modal) return; // dialogs handle their own keys (Esc closes)
      const hit = shortcutFor(e.key);
      if (!hit) return;
      const s = useStore.getState();
      const a = hit.action;
      switch (a.type) {
        case "view":
        case "section": {
          const next = applyNavAction(s.nav(), a);
          if (next) s.navigate(next);
          return;
        }
        case "newRun":
          return openModal("newRun");
        case "demo":
          return void startDemo();
        case "help":
          return openModal("help");
        case "close":
          return;
        case "pauseResume": {
          if (isControl(e.target)) return;
          if (!s.selectedRunId || !isLive(liveModel.status)) return;
          e.preventDefault();
          const action = liveModel.status === "paused" ? api.resume : api.pause;
          action(s.selectedRunId).catch((err) => toastMsg(err.message, "error"));
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, liveModel.status, openModal, toastMsg]);

  // The browser tab says when a run needs you, even from another window.
  const needs = liveModel.pending.length;
  useEffect(() => {
    document.title = needs ? `(${needs}) Reins · needs you` : liveModel.config && isLive(liveModel.status) ? `Reins · running` : "Reins";
  }, [needs, liveModel.status, liveModel.config]);

  const content =
    section === "harness" ? (
      <HarnessPanel model={model} />
    ) : section === "lessons" ? (
      <LessonsPanel />
    ) : section === "reliability" ? (
      <ReliabilityPanel />
    ) : selectedRunId && (liveModel.config || events?.length) ? (
      <RunWorkspace model={model} live={liveModel} />
    ) : selectedRunId && !booting ? (
      <div className="h-full flex items-center justify-center muted">Loading the run…</div>
    ) : (
      <Welcome />
    );

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 min-h-0 flex">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
          {bootError && (
            <div className="px-4 py-2 text-small flex items-center gap-3" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
              Could not reach the Reins server ({bootError}). Is `npm run dev` running?
              <button className="btn btn-sm" onClick={() => useStore.getState().boot()}>
                Retry
              </button>
            </div>
          )}
        </main>
      </div>
      {modal === "newRun" && <NewRun />}
      {modal === "settings" && <Settings />}
      {modal === "help" && <Help />}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 card px-4 py-2 fade-in z-50 ${toast.kind === "error" ? "text-[var(--bad)]" : ""}`} style={{ boxShadow: "var(--shadow)" }} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
