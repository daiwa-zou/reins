import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Menu, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import { useStore } from "../state/store";
import { Kbd } from "./ui";

/** App-level chrome only. Everything about the selected run lives in RunHeader. */
export function TopBar() {
  const info = useStore((s) => s.info);
  const connected = useStore((s) => s.connected);
  const openModal = useStore((s) => s.openModal);
  const noEngine = !!info && !info.hasApiKey && !info.hasClaudeCode;

  return (
    <header className="flex items-center gap-3 px-3 h-11 border-b line shrink-0" style={{ background: "var(--bg-elev)" }}>
      <div className="flex items-center gap-2 font-semibold tracking-tight text-title select-none">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r="14" fill="var(--accent)" />
          <path d="M9 20c3-7 11-7 14 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
        Reins
      </div>
      <span className="flex items-center gap-1.5 text-small muted" role="status" aria-live="polite">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-[var(--ok)]" : "bg-[var(--bad)] pulse"}`} aria-hidden />
        <span className={connected ? "sr-only" : ""}>{connected ? "Connected" : "Reconnecting…"}</span>
      </span>
      <div className="flex-1" />
      <button className="btn btn-primary btn-sm" onClick={() => openModal("newRun")} title="Start a new run (n)">
        <Plus size={14} aria-hidden /> New run <Kbd>n</Kbd>
      </button>
      <AppMenu attention={noEngine} />
    </header>
  );
}

function AppMenu({ attention }: { attention: boolean }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const openModal = useStore((s) => s.openModal);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[role=menuitemradio],[role=menuitem]")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const themes = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ] as const;

  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn relative" aria-label="Menu: theme, settings and help" title="Theme, settings and help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Menu size={16} aria-hidden />
        {attention && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--warn)]" aria-hidden />}
      </button>
      {open && (
        <div className="menu fade-in" role="menu" aria-label="App menu">
          <div className="section-label px-2 pt-1.5 pb-1">Theme</div>
          {themes.map(({ id, label, Icon }) => (
            <button key={id} role="menuitemradio" aria-checked={theme === id} className="menu-item" onClick={pick(() => setTheme(id))}>
              <Icon size={15} aria-hidden /> {label}
            </button>
          ))}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={pick(() => openModal("settings"))}>
            <Settings size={15} aria-hidden /> Settings
            {attention && <span className="ml-auto badge badge-warn">set up</span>}
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(() => openModal("help"))}>
            <Keyboard size={15} aria-hidden /> Keyboard shortcuts <span className="ml-auto"><Kbd>?</Kbd></span>
          </button>
        </div>
      )}
    </div>
  );
}

/** "Title" -> "Title (2)" -> "Title (3)" so repeated runs stay distinguishable in the list. */
export function nextTitle(title: string): string {
  const m = title.match(/^(.*) \((\d+)\)$/);
  return m ? `${m[1]} (${Number(m[2]) + 1})` : `${title} (2)`;
}
