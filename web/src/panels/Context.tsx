import React from "react";
import type { RunModel } from "../state/derive";
import { ROLE_LABEL } from "../state/derive";
import { ContextGauge, ContextHistory } from "../components/ContextGauge";
import { Empty, Badge, Stat } from "../components/ui";
import { useStore } from "../state/store";
import { tokens } from "../lib/format";
import type { RoleId } from "@shared/types";

export function ContextPanel({ model }: { model: RunModel }) {
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const cfg = model.config;
  const roles = Object.keys(model.latestSnapshot) as RoleId[];
  if (!roles.length) return <Empty title="No context data yet" body="Each model call reports how big the prompt was. Reins shows what it is made of and where the harness will intervene." />;
  const cacheHit = model.usage.input + model.usage.cacheRead + model.usage.cacheWrite > 0 ? model.usage.cacheRead / (model.usage.input + model.usage.cacheRead + model.usage.cacheWrite) : 0;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="grid md:grid-cols-3 gap-3">
          <Stat label="Policy" value={cfg?.components.compaction ? `compact at ${tokens(cfg.context.compactAtTokens)}` : "no compaction"} sub={cfg?.components.contextEditing ? `clear tool results, keep last ${cfg.context.clearToolResultsAfterTurns}` : "no clearing"} />
          <Stat label="Cache hit rate" value={`${Math.round(cacheHit * 100)}%`} sub="share of prompt tokens read from cache; a drop means the prefix changed" tone={cacheHit < 0.5 && model.snapshots.length > 3 ? "warn" : undefined} />
          <Stat label="Interventions" value={String(model.contextEvents.length)} sub={model.contextEvents.map((e) => e.what).join(", ") || "none so far"} />
        </div>

        {roles.map((r) => (
          <div key={r} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className={`font-semibold role-${r}`}>{ROLE_LABEL[r]}</div>
              <span className="muted text-[12px]">{model.snapshots.filter((s) => s.role === r).length} turns</span>
            </div>
            <ContextGauge model={model} role={r} />
            <div className="mt-4">
              <ContextHistory model={model} role={r} />
            </div>
          </div>
        ))}

        {model.contextEvents.length > 0 && (
          <div className="card p-4">
            <div className="font-semibold mb-2">Interventions</div>
            <div className="flex flex-col gap-1.5">
              {model.contextEvents.map((e) => (
                <div key={e.seq} className="flex items-center gap-2 text-[12.5px]">
                  <Badge tone={e.what === "reset" ? "bad" : e.what === "compacted" ? "warn" : "neutral"}>{e.what}</Badge>
                  <span className={`role-${e.role} font-medium`}>{ROLE_LABEL[e.role]}</span>
                  <span className="muted">{e.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {model.toolsLoaded.length > 0 && (
          <div className="card p-4">
            <div className="font-semibold mb-2">Tools loaded on demand</div>
            <div className="flex flex-wrap gap-1">
              {model.toolsLoaded.map((t) => (
                <span key={t} className="badge badge-neutral mono">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="muted text-[12px] leading-relaxed">
          Why this view exists: context is a finite attention budget and models lose coherence as it fills. Compaction keeps continuity but not a clean slate; a reset with a written handoff
          fixes "context anxiety" but costs orchestration. Both are switches in the Harness tab.{" "}
          <button className="underline" onClick={() => setLessonFilter("effective-context-engineering-for-ai-agents")}>
            Read the lesson →
          </button>
        </div>
      </div>
    </div>
  );
}
