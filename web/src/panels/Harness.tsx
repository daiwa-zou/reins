import React from "react";
import type { RunModel } from "../state/derive";
import { useStore } from "../state/store";
import { Badge, Switch } from "../components/ui";
import type { ComponentId, HarnessComponent } from "@shared/types";

const GROUP_LABEL: Record<HarnessComponent["group"], string> = { roles: "Roles", memory: "Memory across sessions", context: "Context window", tools: "Tools", safety: "Safety" };

/**
 * The harness as a set of switches. Each component states the assumption about
 * the model it encodes, so when a new model ships you know exactly what to
 * re-test. This view shows the *effective* configuration of the selected run,
 * and lets you launch a new run with components flipped one at a time.
 */
export function HarnessPanel({ model }: { model: RunModel }) {
  const components = useStore((s) => s.components);
  const lessons = useStore((s) => s.lessons);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const openModal = useStore((s) => s.openModal);
  const runs = useStore((s) => s.runs);
  const cfg = model.config;
  const on = cfg?.components;

  // Model-change nudge: compare the selected run's model to the most recent completed run before it.
  const previous = cfg ? runs.filter((r) => r.id !== cfg.id && r.status === "completed" && Date.parse(r.createdAt) < Date.parse(cfg.createdAt))[0] : undefined;
  const modelChanged = previous && cfg && previous.model !== cfg.roles.builder.model;

  const launchWithout = (id: ComponentId) => {
    if (!cfg) return openModal("newRun");
    openModal("newRun", { ...cfg, id: undefined, createdAt: undefined, engine: "anthropic", components: { ...cfg.components, [id]: !cfg.components[id] }, title: `${cfg.title} (${cfg.components[id] ? "without" : "with"} ${components.find((c) => c.id === id)?.label ?? id})` } as any);
  };

  const groups = [...new Set(components.map((c) => c.group))];

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="card p-4">
          <div className="text-[16px] font-semibold tracking-tight">Every component is an assumption about the model.</div>
          <p className="muted mt-1 leading-relaxed text-[12.5px]">
            Scaffolding that was load-bearing for one model is dead weight for the next. Remove pieces one at a time and watch what breaks; removing several at once hides which
            ones mattered. {cfg ? "Below is the effective configuration of the selected run." : "Select a run to see its effective configuration, or start a new one."}
          </p>
          {modelChanged && (
            <div className="mt-3 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
              <b>Model changed</b> since your last completed run ({previous.model} → {cfg!.roles.builder.model}). This is the moment to re-examine the harness: try the same task with one component off.
            </div>
          )}
        </div>

        {groups.map((g) => (
          <div key={g}>
            <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-2">{GROUP_LABEL[g]}</div>
            <div className="grid md:grid-cols-2 gap-2">
              {components
                .filter((c) => c.group === g)
                .map((c) => {
                  const enabled = on ? on[c.id] : c.defaultOn;
                  return (
                    <div key={c.id} className={`card p-3 flex flex-col gap-1.5 ${enabled ? "" : "opacity-70"}`}>
                      <div className="flex items-center gap-2">
                        <div className="font-semibold flex-1">{c.label}</div>
                        {cfg ? <Badge tone={enabled ? "ok" : "neutral"}>{enabled ? "on" : "off"}</Badge> : <Switch checked={enabled} onChange={() => launchWithout(c.id)} label={c.label} />}
                      </div>
                      <div className="text-[12.5px] leading-relaxed">{c.short}</div>
                      <div className="text-[11.5px] muted leading-relaxed">
                        <span className="faint">assumes:</span> {c.assumption}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {c.lessons.map((slug) => {
                          const l = lessons.find((x) => x.slug === slug);
                          return (
                            <button key={slug} className="badge badge-accent hover:brightness-95" onClick={() => setLessonFilter(slug)} title={l?.takeaway}>
                              {l?.title.split(":")[0].slice(0, 40) ?? slug}
                            </button>
                          );
                        })}
                        <span className="flex-1" />
                        {cfg && (
                          <button className="btn btn-ghost btn-sm" onClick={() => launchWithout(c.id)} title="Start a new run with this component flipped">
                            run {enabled ? "without" : "with"} →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}

        {cfg && (
          <div className="card p-4">
            <div className="font-semibold mb-2">Effective configuration</div>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
              {(["planner", "builder", "evaluator", "classifier"] as const).map((r) => (
                <Row key={r} k={r} v={`${cfg.roles[r].model} · effort ${cfg.roles[r].effort}`} />
              ))}
              <Row k="budget" v={`$${cfg.budgetUsd} · ${cfg.maxTurnsPerPhase} turns/phase · ${cfg.maxFixRounds} fix rounds`} />
              <Row k="context" v={`compact ${cfg.context.compactAtTokens.toLocaleString()} · clear keep ${cfg.context.clearToolResultsAfterTurns} · reset ${cfg.context.resetAtTokens.toLocaleString()}`} />
              <Row k="guardrail" v={`${cfg.guardrail.mode} · network ${cfg.guardrail.allowNetwork ? "on" : "off"}`} />
              <Row k="pauses" v={Object.entries(cfg.pauses).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"} />
              <Row k="engine" v={cfg.engine} />
              <Row k="workspace" v={cfg.workspace} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="faint w-20 shrink-0">{k}</span>
      <span className="mono text-[11.5px] truncate" title={v}>
        {v}
      </span>
    </div>
  );
}
