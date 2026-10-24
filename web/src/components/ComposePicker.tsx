import React from "react";
import type { Lesson } from "@shared/types";
import { domainPresets, PROFILE_IDS, presetChip, presetsLabel } from "@shared/presets";
import { Badge } from "./ui";
import { compositionError } from "../state/runChip";

export interface DomainSuggestion {
  domain: string;
  reason: string;
}

/**
 * Composable presets: exactly one care profile plus any number of domain
 * presets, layered in the order picked (see shared/presets.ts composeRun).
 * `value` is the run's `presets` list, profile first. An invalid composition
 * (two profiles, none, an unknown domain) is a PresetCompositionError from
 * composeRun; compositionError() turns it into the inline message below.
 */
export function ComposePicker({ lessons, value, suggestions, onChange }: { lessons: Lesson[]; value: string[]; suggestions: DomainSuggestion[]; onChange: (ids: string[]) => void }) {
  const profile = value.find((x) => (PROFILE_IDS as readonly string[]).includes(x));
  const picked = value.filter((x) => x !== profile);
  const domains = domainPresets(lessons);
  const ids = [...new Set([...domains.map((d) => d.id!), ...suggestions.map((s) => s.domain)])];
  const error = compositionError(value, lessons);
  const reason = (d: string) => suggestions.find((s) => s.domain === d)?.reason;
  const setProfile = (p: string) => onChange([p, ...picked]);
  const toggle = (d: string) => {
    const next = picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d];
    onChange([profile ?? "full", ...next]);
  };
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]" data-compose-picker>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Care profile">
        <span className="font-semibold">Care profile</span>
        {PROFILE_IDS.map((p) => (
          <label key={p} className="inline-flex items-center gap-1 cursor-pointer">
            <input type="radio" name="care-profile" value={p} checked={profile === p} onChange={() => setProfile(p)} />
            {presetChip(p)}
          </label>
        ))}
        {value.length > 0 && (
          <>
            <Badge tone="accent" title="The run title chip">
              {presetsLabel(value)}
            </Badge>
            <button className="btn btn-ghost btn-sm" onClick={() => onChange([])} title="Stop composing; keep the settings below as they are">
              clear
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Domain presets">
        <span className="font-semibold">Domains</span>
        {ids.map((d) => {
          const on = picked.includes(d);
          const why = reason(d);
          const known = domains.some((x) => x.id === d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              disabled={!known}
              className={`badge ${on ? "badge-accent" : "badge-neutral"} hover:brightness-95`}
              title={known ? `${domains.find((x) => x.id === d)?.description ?? ""}${why ? `\nSuggested: ${why}` : ""}` : `No lesson names the domain "${d}" yet${why ? ` (suggested: ${why})` : ""}`}
              onClick={() => toggle(d)}
              data-domain={d}
            >
              {on ? "✓ " : ""}
              {presetChip(d)}
              {why && <span className="muted"> · suggested: {why}</span>}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="text-[11.5px] leading-snug text-[var(--bad)]" role="alert" data-compose-error>
          {error}
        </div>
      )}
      <div className="muted text-[11.5px]">Domains layer over the profile in the order picked: later switches win, guidance and stage lessons are merged and capped. The engine stays the profile's.</div>
    </div>
  );
}
