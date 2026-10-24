import type { Lesson, RunConfig } from "@shared/types";
import { composeRun, PresetCompositionError, presetsLabel } from "@shared/presets";

/**
 * The chip beside a run's title: "Careful · Go · CLI" for a composed run,
 * the saved preset name for older runs, "Lesson intake" for intake jobs.
 */
export function runPresetChip(cfg: Pick<RunConfig, "preset" | "presets" | "job"> | null | undefined): string {
  if (!cfg) return "";
  if (cfg.job === "intake") return "Lesson intake";
  if (cfg.presets?.length) return presetsLabel(cfg.presets);
  return cfg.preset ?? "";
}

/**
 * Check a composition the way the server will (shared/presets.ts composeRun)
 * and return the problem as a string for New run to show inline; null when it
 * composes. Never throws.
 */
export function compositionError(ids: string[], lessons: Lesson[]): string | null {
  if (!ids.length) return null;
  try {
    composeRun(ids, lessons);
    return null;
  } catch (e) {
    if (e instanceof PresetCompositionError) return e.message;
    return `could not compose these presets: ${(e as Error)?.message ?? String(e)}`;
  }
}
