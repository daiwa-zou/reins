import React from "react";
import { useStore } from "../state/store";
import type { RunModel } from "../state/derive";
import { isLive } from "../state/derive";
import { StatusBadge, Kbd } from "./ui";
import { api } from "../lib/api";
import { money, duration, tilde } from "../lib/format";

export function TopBar({ model }: { model: RunModel }) {
  const info = useStore((s) => s.info);
  const connected = useStore((s) => s.connected);
  const openModal = useStore((s) => s.openModal);
  const toastMsg = useStore((s) => s.toastMsg);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const cfg = model.config;
  const live = isLive(model.status);

  const act = (fn: (id: string) => Promise<unknown>) => () => selectedRunId && fn(selectedRunId).catch((e) => toastMsg(e.message, "error"));
  const elapsed = model.startedTs && model.lastTs ? Date.parse(model.lastTs) - Date.parse(model.startedTs) : 0;

  return (
    <header className="flex items-center gap-3 px-3 h-12 border-b line" style={{ background: "var(--bg-elev)" }}>
      <div className="flex items-center gap-2 font-semibold tracking-tight text-[15px] select-none">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r="14" fill="var(--accent)" />
          <path d="M9 20c3-7 11-7 14 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
        Reins
      </div>
      <span className={`w-2 h-2 rounded-full ${connected ? "bg-[var(--ok)]" : "bg-[var(--bad)] pulse"}`} title={connected ? "Connected" : "Reconnecting…"} />

      {cfg && (
        <div className="flex items-center gap-2 min-w-0 ml-2">
          <div className="truncate font-medium max-w-[38vw]" title={cfg.task}>
            {cfg.title}
          </div>
          <StatusBadge status={model.status} />
          <span className="muted text-[12px] truncate hidden md:inline" title={cfg.workspace}>
            {tilde(cfg.workspace, info?.home)}
          </span>
          {cfg.engine === "replay" && <span className="badge badge-neutral">recorded demo</span>}
        </div>
      )}
      <div className="flex-1" />
      {cfg && (
        <div className="hidden lg:flex items-center gap-4 text-[12px] muted mono">
          <span title="Cost so far">{money(model.costUsd)}</span>
          <span title="Elapsed">{duration(elapsed)}</span>
        </div>
      )}
      {cfg && live && (
        <div className="flex items-center gap-1">
          {model.status === "paused" ? (
            <button className="btn btn-sm" onClick={act(api.resume)} title="Resume (space)">
              ▶ Resume
            </button>
          ) : (
            <button className="btn btn-sm" onClick={act(api.pause)} title="Pause (space)">
              ❚❚ Pause
            </button>
          )}
          <button className="btn btn-sm btn-danger" onClick={() => confirm("Cancel this run? The agent stops after its current tool call.") && act(api.cancel)()}>
            Stop
          </button>
        </div>
      )}
      {cfg && !live && (
        <button className="btn btn-sm" onClick={() => openModal("newRun", { ...cfg, id: undefined, createdAt: undefined, engine: cfg.engine === "replay" ? "anthropic" : cfg.engine } as any)} title="Start a new run with the same settings (pass^k)">
          ↻ Run again
        </button>
      )}
      <button className="btn btn-primary btn-sm" onClick={() => openModal("newRun")}>
        New run <Kbd>n</Kbd>
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")} title={`Theme: ${theme}`} aria-label="Toggle theme">
        {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => openModal("settings")} title="Settings" aria-label="Settings">
        ⚙{!info?.hasApiKey && <span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)]" />}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => openModal("help")} title="Keyboard shortcuts" aria-label="Help">
        ?
      </button>
    </header>
  );
}
