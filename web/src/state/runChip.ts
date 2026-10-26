import type { Composition, Lesson, RunConfig, UserDomain } from "@shared/types";
import { composeRun, PresetCompositionError, runChipLabel } from "@shared/presets";

/**
 * The chip beside a run's title: "High · Check in · Go · CLI" for a composed run
 * (plus "· Experiment: without …" when ablated), the old text ("Careful · Go · CLI",
 * or the saved preset name) for runs that predate Effort and Supervision,
 * "Lesson intake" for intake jobs.
 */
export function runPresetChip(cfg: Pick<RunConfig, "preset" | "presets" | "job" | "effort" | "supervision" | "domains" | "ablated"> | null | undefined): string {
  if (!cfg) return "";
  if (cfg.job === "intake") return "Lesson intake";
  return runChipLabel(cfg);
}

/**
 * Check a composition the way the server will (shared/presets.ts composeRun)
 * and return the problem as a string for New run to show inline; null when it
 * composes. Never throws.
 */
export function compositionError(comp: Partial<Composition>, lessons: Lesson[], userDomains: UserDomain[] = []): string | null {
  try {
    composeRun(comp, lessons, undefined, undefined, userDomains);
    return null;
  } catch (e) {
    if (e instanceof PresetCompositionError) return e.message;
    return `could not compose: ${(e as Error)?.message ?? String(e)}`;
  }
}
