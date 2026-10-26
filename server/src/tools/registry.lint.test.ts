import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./registry.js";

// The writing-tools lesson: descriptions written "as for a new hire", examples for
// the tricky inputs, and no two tools a person could not tell apart.
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};

describe("tool registry lint", () => {
  const entries = Object.entries(ALL_TOOLS).map(([name, t]) => [name, t.schema as any] as const);

  it("every description says enough for a newcomer", () => {
    for (const [name, s] of entries) expect(s.description.length, name).toBeGreaterThanOrEqual(40);
  });

  it("tools with array-of-object inputs ship an example call", () => {
    for (const [name, s] of entries) {
      const props = s.input_schema?.properties ?? {};
      const hasNested = Object.values<any>(props).some((p) => p.type === "array" && p.items?.type === "object");
      if (hasNested) expect(Array.isArray(s.input_examples) && s.input_examples.length > 0, `${name} needs input_examples`).toBe(true);
    }
  });

  it("no two tools read as the same tool", () => {
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++) {
        const sim = jaccard(words(entries[i][1].description), words(entries[j][1].description));
        expect(sim, `${entries[i][0]} vs ${entries[j][0]} overlap ${sim.toFixed(2)}`).toBeLessThan(0.6);
      }
  });

  it("parameter names are consistent across tools", () => {
    const names = new Set<string>();
    for (const [, s] of entries) for (const k of Object.keys(s.input_schema?.properties ?? {})) names.add(k);
    // Workspace files are always `path`; never `filename` or `file_path` in Reins' own tools.
    expect([...names].filter((n) => /^(filename|file_path|filepath)$/.test(n))).toEqual([]);
  });
});
