import React from "react";
import { Plus } from "lucide-react";
import type { Composition, HarnessEffort, Lesson, Supervision, UserDomain } from "@shared/types";
import { DEFAULT_COMPOSITION, EFFORT_LEVELS, EFFORT_TABLE, SUPERVISION_LEVELS, SUPERVISION_TABLE } from "@shared/components";
import { domainPresets, effortRecommendations, presetChip } from "@shared/presets";
import { compositionError } from "../state/runChip";

export interface DomainSuggestion {
  domain: string;
  reason: string;
}

function Segmented<T extends string>({ name, label, ids, value, labelOf, meaningOf, onPick }: { name: string; label: string; ids: T[]; value: T | undefined; labelOf: (id: T) => string; meaningOf: (id: T) => string; onPick: (id: T) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold w-[84px]" id={`${name}-label`}>
          {label}
        </span>
        <div className="seg" role="radiogroup" aria-labelledby={`${name}-label`} data-control={name}>
          {ids.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={value === id} {...{ [`data-${name}`]: id }} title={meaningOf(id)} onClick={() => onPick(id)}>
              {labelOf(id)}
            </button>
          ))}
        </div>
      </div>
      <div className="faint text-[11.5px] leading-snug pl-[92px]" data-meaning={name}>
        {value ? meaningOf(value) : ""}
      </div>
    </div>
  );
}

/**
 * Effort + Supervision + Domains (shared/presets.ts composeRun). Effort decides what the harness
 * spends; Supervision decides when it asks you; domains layer lessons in the order picked. Lesson
 * recommendations for an effort level are shown with their reason and a Use button, never applied silently.
 */
export function ComposePicker({ lessons, userDomains = [], value, suggestions, onChange, onOpenLesson, onBuildDomain }: { lessons: Lesson[]; userDomains?: UserDomain[]; value: Partial<Composition> | null; suggestions: DomainSuggestion[]; onChange: (c: Composition) => void; onOpenLesson?: (slug: string) => void; onBuildDomain?: () => void }) {
  const cur: Composition = { effort: value?.effort ?? DEFAULT_COMPOSITION.effort, supervision: value?.supervision ?? DEFAULT_COMPOSITION.supervision, domains: value?.domains ?? [] };
  const active = !!value;
  const picked = cur.domains;
  const domains = domainPresets(lessons, userDomains);
  const ids = [...new Set([...domains.map((d) => d.id!), ...suggestions.map((s) => s.domain)])];
  const error = active ? compositionError(cur, lessons, userDomains) : null;
  const reason = (d: string) => suggestions.find((s) => s.domain === d)?.reason;
  const toggle = (d: string) => onChange({ ...cur, domains: picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d] });
  const recs = effortRecommendations(lessons, picked);
  return (
    <div className="flex flex-col gap-2 text-[12.5px]" data-compose-picker>
      <Segmented<HarnessEffort> name="effort" label="Effort" ids={EFFORT_LEVELS} value={active ? cur.effort : undefined} labelOf={(id) => EFFORT_TABLE[id].label} meaningOf={(id) => EFFORT_TABLE[id].meaning} onPick={(effort) => onChange({ ...cur, effort })} />
      <Segmented<Supervision> name="supervision" label="Supervision" ids={SUPERVISION_LEVELS} value={active ? cur.supervision : undefined} labelOf={(id) => SUPERVISION_TABLE[id].label} meaningOf={(id) => SUPERVISION_TABLE[id].meaning} onPick={(supervision) => onChange({ ...cur, supervision })} />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="domains-label">
        <span className="font-semibold w-[84px]" id="domains-label">
          Domains
        </span>
        {ids.map((d) => {
          const on = picked.includes(d);
          const why = reason(d);
          const known = domains.some((x) => x.id === d);
          return (
            <button key={d} type="button" aria-pressed={on} disabled={!known} className={`badge ${on ? "badge-accent" : "badge-neutral"} hover:brightness-95`} title={known ? `${domains.find((x) => x.id === d)?.description ?? ""}${why ? `\nSuggested: ${why}` : ""}` : `No lesson names the domain "${d}" yet${why ? ` (suggested: ${why})` : ""}`} onClick={() => toggle(d)} data-domain={d}>
              {on ? "✓ " : ""}
              {domains.find((x) => x.id === d)?.user ? domains.find((x) => x.id === d)!.name : presetChip(d)}
              {why && <span className="muted"> · suggested</span>}
            </button>
          );
        })}
        <span className="faint text-[11.5px]">what kind of project; pick any</span>
        {onBuildDomain && (
          <button type="button" className="chip chip-add" style={{ height: 24, width: 24 }} onClick={onBuildDomain} aria-label="Build a domain from the lessons' implications" title="Build a domain…" data-build-domain>
            <Plus size={13} aria-hidden />
          </button>
        )}
      </div>
      {recs.map((r) => (
        <div key={`${r.slug}:${r.claim}`} className="rounded-md border line px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-[12px]" data-effort-recommendation={r.level}>
          <span>
            <b>{presetChip(r.domain)}:</b> {r.claim}{" "}
            <button type="button" className="link" onClick={() => onOpenLesson?.(r.slug)}>
              ({r.slug})
            </button>
          </span>
          {r.level === cur.effort ? (
            <span className="faint ml-auto">{EFFORT_TABLE[r.level].label} is selected</span>
          ) : (
            <button type="button" className="btn btn-sm ml-auto" data-use-effort={r.level} onClick={() => onChange({ ...cur, effort: r.level })}>
              Use {EFFORT_TABLE[r.level].label}
            </button>
          )}
        </div>
      ))}
      {error && (
        <div className="text-[11.5px] leading-snug text-[var(--bad)]" role="alert" data-compose-error>
          {error}
        </div>
      )}
    </div>
  );
}
