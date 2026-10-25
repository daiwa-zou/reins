import React from "react";
import type { Lesson } from "@shared/types";
import { BUILT_IN_PRESETS } from "@shared/config";
import { domainPresets, PROFILE_IDS, presetChip } from "@shared/presets";
import { compositionError } from "../state/runChip";

export interface DomainSuggestion {
  domain: string;
  reason: string;
}

/**
 * Profile + Domains: exactly one profile and any number of domains, layered
 * in the order picked (shared/presets.ts composeRun). `value` is the run's
 * `presets` list, profile first; an empty list means nothing is picked here
 * (a saved preset or custom settings are active), so nothing shows pressed.
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
    <div className="flex flex-col gap-2 text-[12.5px]" data-compose-picker>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold w-[64px]" id="profile-label">
          Profile
        </span>
        <div className="inline-flex rounded-lg border line overflow-hidden" role="radiogroup" aria-labelledby="profile-label">
          {PROFILE_IDS.map((p) => {
            const on = profile === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                data-profile={p}
                className={`px-3 py-1 text-[12.5px] ${on ? "bg-[var(--accent)] text-white" : "hover:brightness-95"}`}
                title={BUILT_IN_PRESETS.find((x) => x.id === p)?.description}
                onClick={() => setProfile(p)}
              >
                {presetChip(p)}
              </button>
            );
          })}
        </div>
        <span className="faint text-[11.5px]">how careful the run is</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="domains-label">
        <span className="font-semibold w-[64px]" id="domains-label">
          Domains
        </span>
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
              {why && <span className="muted"> · suggested</span>}
            </button>
          );
        })}
        <span className="faint text-[11.5px]">what kind of project; pick any</span>
      </div>
      {error && (
        <div className="text-[11.5px] leading-snug text-[var(--bad)]" role="alert" data-compose-error>
          {error}
        </div>
      )}
    </div>
  );
}
