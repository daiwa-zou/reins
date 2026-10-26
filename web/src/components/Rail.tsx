import React, { useEffect, useRef, useState } from "react";
import { BookOpen, FlaskConical, Keyboard, ListChecks, Monitor, Moon, MoreHorizontal, Play, Settings, Sun, type LucideIcon } from "lucide-react";
import { useStore, SECTIONS, type Section } from "../state/store";
import { keyForSection } from "../state/nav";
import { Kbd } from "./ui";

const ICON: Record<Section, LucideIcon> = { runs: ListChecks, harness: Play, lessons: BookOpen, reliability: FlaskConical };

/**
 * The one piece of chrome on every screen: the brand (with the connection
 * state), the four sections as icon-over-label buttons, and a More menu with
 * theme, settings and help. The run list lives inside Runs, not here.
 */
export function Rail() {
  const section = useStore((s) => s.section);
  const navigate = useStore((s) => s.navigate);
  const connected = useStore((s) => s.connected);
  const info = useStore((s) => s.info);
  const needs = useStore((s) => s.runs.filter((r) => r.status === "waiting_approval").length);
  const drafts = useStore((s) => s.intakeJobs.filter((j) => j.status === "waiting_approval" && j.active).length);
  const noEngine = !!info && !info.hasApiKey && !info.hasClaudeCode;

  return (
    <nav aria-label="Sections" className="w-16 shrink-0 border-r line flex flex-col items-center py-2 gap-1" style={{ background: "var(--bg-elev)" }}>
      <div className="relative my-1.5 select-none" title={connected ? "Reins · connected" : "Reins · reconnecting…"} aria-hidden>
        <svg width="28" height="28" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="var(--accent)" />
          <path d="M9 20c3-7 11-7 14 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
        <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 ${connected ? "bg-[var(--ok)]" : "bg-[var(--bad)] pulse"}`} style={{ borderColor: "var(--bg-elev)" }} />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {connected ? "Connected" : "Reconnecting…"}
      </span>
      {SECTIONS.map((s) => {
        const Icon = ICON[s.id];
        const key = keyForSection(s.id);
        const count = s.id === "runs" ? needs : s.id === "lessons" ? drafts : 0;
        return (
          <button key={s.id} className="rail-btn" aria-current={section === s.id ? "page" : undefined} onClick={() => navigate({ section: s.id })} title={`${s.hint}${key ? ` (${key})` : ""}`}>
            <Icon size={18} aria-hidden />
            <span>{s.label}</span>
            {count > 0 && (
              <span className="badge badge-warn" title={s.id === "runs" ? `${count} run${count === 1 ? "" : "s"} waiting for you` : `${count} lesson draft${count === 1 ? "" : "s"} waiting for your review`} data-lesson-drafts={s.id === "lessons" ? "" : undefined}>
                {count}
              </span>
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      <MoreMenu attention={noEngine} />
    </nav>
  );
}

function MoreMenu({ attention }: { attention: boolean }) {
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
      <button className="rail-btn" aria-label="More: theme, settings and help" title="Theme, settings and help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={18} aria-hidden />
        <span>More</span>
        {attention && <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-[var(--warn)]" aria-hidden />}
      </button>
      {open && (
        <div className="menu menu-beside fade-in" role="menu" aria-label="More">
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
            <Keyboard size={15} aria-hidden /> Keyboard shortcuts
            <span className="ml-auto">
              <Kbd>?</Kbd>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
