import { MODELS } from "../../../shared/components.js";
import type { Usage } from "../../../shared/types.js";

export function costUsd(model: string, u: Usage): number {
  const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
  const writePerM = m.inputPerM * 1.25;
  return (
    (u.input * m.inputPerM + u.output * m.outputPerM + u.cacheRead * m.cacheReadPerM + u.cacheWrite * writePerM) /
    1_000_000
  );
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Rough token estimate for composition breakdowns (labelled as estimate in the UI). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
