import { describe, expect, it } from "vitest";
import { finishedDuration, liveElapsed, relTimeAt, runElapsed } from "./time";

const t0 = "2026-10-24T10:00:00.000Z";
const at = (s: number) => Date.parse(t0) + s * 1000;
const iso = (s: number) => new Date(at(s)).toISOString();

describe("live clock helpers", () => {
  it("a pending item's elapsed time grows with now", () => {
    expect(liveElapsed(t0, undefined, at(5))).toBe(5000);
    expect(liveElapsed(t0, undefined, at(6))).toBe(6000);
  });
  it("a finished item's time is fixed regardless of now", () => {
    expect(liveElapsed(t0, iso(3), at(5))).toBe(3000);
    expect(liveElapsed(t0, iso(3), at(500))).toBe(3000);
    expect(finishedDuration(t0, iso(3))).toBe(3000);
  });
  it("an item left unfinished in a failed or cancelled run does not grow", () => {
    const a = liveElapsed(t0, undefined, at(10), { live: false, lastTs: iso(4) });
    const b = liveElapsed(t0, undefined, at(9999), { live: false, lastTs: iso(4) });
    expect(a).toBe(4000);
    expect(b).toBe(a);
    // no last known time: '–' (undefined), still not growing
    expect(liveElapsed(t0, undefined, at(10), { live: false })).toBeUndefined();
    expect(liveElapsed(t0, undefined, at(99), { live: false })).toBeUndefined();
  });
  it("run elapsed ticks while live, then shows summary.durationMs or lastTs - startedTs", () => {
    const m = { startedTs: t0, lastTs: iso(7) };
    expect(runElapsed(m, at(20), true)).toBe(20_000);
    expect(runElapsed(m, at(20), false)).toBe(7000);
    expect(runElapsed(m, at(999), false)).toBe(7000);
    expect(runElapsed({ ...m, summary: { durationMs: 6500 } }, at(999), false)).toBe(6500);
  });
  it("relative time follows the passed clock", () => {
    expect(relTimeAt(t0, at(30))).toBe("just now");
    expect(relTimeAt(t0, at(150))).toBe("2m ago");
  });
});
