import React, { useEffect, useRef, useState } from "react";
import type { RoleId, RunStatus } from "@shared/types";
import { ROLE_LABEL } from "../state/derive";
import { Ban, ChevronRight, CircleCheck, CirclePause, CircleX, Clock, Hand, LoaderCircle } from "lucide-react";

export function Badge({ tone = "neutral", children, title }: { tone?: "ok" | "warn" | "bad" | "neutral" | "accent"; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const STATUS: Record<RunStatus, { tone: "ok" | "warn" | "bad" | "neutral" | "accent"; label: string; pulse?: boolean }> = {
  queued: { tone: "neutral", label: "Queued" },
  running: { tone: "accent", label: "Running", pulse: true },
  paused: { tone: "warn", label: "Paused" },
  waiting_approval: { tone: "warn", label: "Needs you", pulse: true },
  completed: { tone: "ok", label: "Completed" },
  failed: { tone: "bad", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

/** Compact status for list rows: an icon with an accessible label. */
export function StatusIcon({ status, size = 14 }: { status: RunStatus; size?: number }) {
  const m = STATUS[status];
  const color = m.tone === "neutral" ? "var(--fg-faint)" : `var(--${m.tone})`;
  const Icon = { queued: Clock, running: LoaderCircle, paused: CirclePause, waiting_approval: Hand, completed: CircleCheck, failed: CircleX, cancelled: Ban }[status];
  return (
    <span className="inline-flex shrink-0" style={{ color }} role="img" aria-label={m.label} title={m.label}>
      <Icon size={size} className={status === "running" ? "animate-spin [animation-duration:2.4s]" : status === "waiting_approval" ? "pulse" : undefined} aria-hidden />
    </span>
  );
}

export function StatusBadge({ status }: { status: RunStatus }) {
  const m = STATUS[status];
  return (
    <Badge tone={m.tone}>
      {m.pulse && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current pulse" />}
      {m.label}
    </Badge>
  );
}

export function RoleDot({ role, size = 8 }: { role: RoleId; size?: number }) {
  return <span className={`inline-block rounded-full bg-role-${role}`} style={{ width: size, height: size }} aria-hidden />;
}

export function RoleChip({ role }: { role: RoleId }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-caption font-semibold role-${role}`}>
      <RoleDot role={role} />
      {ROLE_LABEL[role]}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-10 gap-2 fade-in">
      {icon && <div className="text-3xl mb-1 faint">{icon}</div>}
      <div className="font-semibold text-title">{title}</div>
      {body && <div className="muted max-w-md">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Collapsible({ summary, children, defaultOpen = false, className = "" }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button type="button" className="w-full text-left flex items-center gap-2 muted hover:text-[var(--fg)] text-small" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={13} className="shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} aria-hidden />
        {summary}
      </button>
      {open && <div className="mt-1.5 fade-in">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 720, dismissOnBackdrop = true }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; width?: number; dismissOnBackdrop?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers usually pass a fresh arrow function for onClose on every render;
  // keep it in a ref so the focus effect runs once per mount, not per keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute("disabled"));
    // Skip the Close button (first focusable) when there is anything else to focus.
    (focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key === "Tab") {
        const els = focusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] px-4" style={{ background: "rgba(10,10,12,0.45)" }} onMouseDown={(e) => dismissOnBackdrop && e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="card fade-in flex flex-col max-h-[88vh] w-full" style={{ maxWidth: width, boxShadow: "var(--shadow)" }} role="dialog" aria-modal aria-label={typeof title === "string" ? title : undefined}>
        <div className="flex items-center justify-between px-5 py-3 border-b line">
          <div className="font-semibold text-title">{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </div>
        <div className="overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Pre({ children, max = 320 }: { children: string; max?: number }) {
  const [expanded, setExpanded] = useState(false);
  const long = children.length > max && !expanded;
  return (
    <div>
      <pre className="sunk rounded-md p-2.5 text-[11.5px] leading-snug overflow-auto max-h-[420px]">{long ? children.slice(0, max) + "…" : children}</pre>
      {children.length > max && (
        <button className="btn btn-ghost btn-sm mt-1" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `Show all (${children.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

export function useAutoScroll<T extends HTMLElement>(dep: unknown, enabled = true) {
  const ref = useRef<T>(null);
  const stick = useRef(true);
  const [behind, setBehind] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (stick.current) setBehind(false);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    if (enabled && stick.current) ref.current.scrollTop = ref.current.scrollHeight;
    else if (enabled) setBehind(true);
  }, [dep, enabled]);
  const jump = () => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    stick.current = true;
    setBehind(false);
  };
  return Object.assign(ref, { behind, jump });
}

export function Meter({ value, max, tone = "accent", height = 6 }: { value: number; max: number; tone?: "accent" | "ok" | "warn" | "bad"; height?: number }) {
  const frac = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="rounded-full sunk overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${frac * 100}%`, background: `var(--${tone})` }} />
    </div>
  );
}


/** Arrow/Home/End navigation for a role=tablist whose tabs use a roving tabindex. */
export function rovingTabs(e: React.KeyboardEvent, ids: string[], current: string, select: (id: string) => void) {
  const i = ids.indexOf(current);
  if (i < 0) return;
  let next = -1;
  if (e.key === "ArrowRight") next = (i + 1) % ids.length;
  else if (e.key === "ArrowLeft") next = (i - 1 + ids.length) % ids.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = ids.length - 1;
  if (next < 0) return;
  e.preventDefault();
  select(ids[next]);
  requestAnimationFrame(() => (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`)?.focus());
}
