import React, { useState } from "react";
import { BookOpen, FlaskConical, ListChecks, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useStore, SECTIONS, type Section } from "../state/store";
import { keyForSection } from "../state/nav";
import { RunList } from "./RunList";

const ICON: Record<Section, LucideIcon> = {
  runs: ListChecks,
  reliability: FlaskConical,
  harness: SlidersHorizontal,
  lessons: BookOpen,
};

/** Persistent left column: the app sections, then the run list. */
export function Sidebar() {
  const section = useStore((s) => s.section);
  const navigate = useStore((s) => s.navigate);
  const needs = useStore((s) => s.runs.filter((r) => r.status === "waiting_approval").length);
  const [collapsed, setCollapsed] = useState(false);

  const items = SECTIONS.map((s) => {
    const Icon = ICON[s.id];
    const key = keyForSection(s.id);
    return (
      <button
        key={s.id}
        className="nav-item relative"
        aria-current={section === s.id ? "page" : undefined}
        onClick={() => navigate({ section: s.id })}
        title={`${s.hint}${key ? ` (${key})` : ""}`}
        aria-label={collapsed ? s.label : undefined}
        style={collapsed ? { justifyContent: "center", padding: 6 } : undefined}
      >
        <Icon size={16} aria-hidden />
        {!collapsed && <span className="flex-1">{s.label}</span>}
        {s.id === "runs" && needs > 0 && <span className={`badge badge-warn ${collapsed ? "absolute ml-5 -mt-4 px-1" : ""}`}>{needs}</span>}
      </button>
    );
  });

  if (collapsed)
    return (
      <nav aria-label="App" className="w-12 shrink-0 border-r line flex flex-col items-center py-2 gap-1" style={{ background: "var(--bg-elev)" }}>
        {items}
        <div className="flex-1" />
        <button className="icon-btn" onClick={() => setCollapsed(false)} aria-label="Show the sidebar" title="Show the sidebar">
          <PanelLeftOpen size={16} aria-hidden />
        </button>
      </nav>
    );

  return (
    <nav aria-label="App" className="w-[232px] xl:w-[256px] shrink-0 border-r line flex flex-col" style={{ background: "var(--bg-elev)" }}>
      <div className="px-2 pt-2 pb-1 flex flex-col gap-0.5">{items}</div>
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5 border-t line mt-1.5">
        <span className="section-label">All runs</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setCollapsed(true)} aria-label="Hide the sidebar" title="Hide the sidebar">
          <PanelLeftClose size={14} aria-hidden />
        </button>
      </div>
      <RunList />
    </nav>
  );
}
