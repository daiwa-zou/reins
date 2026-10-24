import { describe, expect, it } from "vitest";
import { groupCalls, isFlagged, summarizeNames, type CallEntry } from "./feedGroups";

interface C {
  id: string;
  turn: number;
  name: string;
  result?: { ok: boolean };
  guardrail?: { verdict: string; source?: string };
}
const ok = (id: string, turn = 1, name = "read_file"): C => ({ id, turn, name, result: { ok: true } });
const fail = (id: string, turn = 1): C => ({ id, turn, name: "bash", result: { ok: false } });
const byTurn = (c: C) => c.turn;
const ids = (e: CallEntry<C>[]) => e.map((x) => (x.kind === "group" ? x.calls.map((c) => c.id) : x.call.id));

describe("groupCalls", () => {
  it("(a) 5 consecutive OK calls in one turn become 1 group of 5", () => {
    const out = groupCalls([ok("a"), ok("b"), ok("c"), ok("d"), ok("e")], byTurn);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("group");
    expect(out[0].kind === "group" && out[0].calls).toHaveLength(5);
  });

  it("(b) OK,OK,FAIL,OK,OK keeps the failed call standalone and visible", () => {
    const out = groupCalls([ok("a"), ok("b"), fail("x"), ok("c"), ok("d")], byTurn);
    expect(ids(out)).toEqual([["a", "b"], "x", ["c", "d"]]);
    expect(out[1]).toEqual({ kind: "call", call: expect.objectContaining({ id: "x" }) });
    // The failed call is never inside any group.
    for (const e of out) if (e.kind === "group") expect(e.calls.some((c) => c.result?.ok === false)).toBe(false);
  });

  it("(c) calls with guardrail verdict deny or ask stay visible", () => {
    const denied: C = { ...ok("deny"), guardrail: { verdict: "deny", source: "rules" } };
    const asked: C = { ...ok("ask"), guardrail: { verdict: "ask", source: "classifier" } };
    const out = groupCalls([ok("a"), ok("b"), denied, ok("c"), asked, ok("d"), ok("e")], byTurn);
    expect(ids(out)).toEqual([["a", "b"], "deny", "c", "ask", ["d", "e"]]);
    for (const e of out) if (e.kind === "group") expect(e.calls.some((c) => c.guardrail && c.guardrail.verdict !== "allow")).toBe(false);
  });

  it("an allowed guardrail decision does not stop grouping", () => {
    const allowed: C = { ...ok("allowed"), guardrail: { verdict: "allow", source: "rules" } };
    expect(ids(groupCalls([ok("a"), allowed, ok("b")], byTurn))).toEqual([["a", "allowed", "b"]]);
  });

  it("(d) a single OK call is not wrapped in a group", () => {
    expect(groupCalls([ok("a")], byTurn)).toEqual([{ kind: "call", call: expect.objectContaining({ id: "a" }) }]);
    // Nor is a lone OK call between two flagged ones.
    expect(ids(groupCalls([fail("x"), ok("a"), fail("y")], byTurn))).toEqual(["x", "a", "y"]);
  });

  it("(e) calls in two different turns produce separate groups", () => {
    const out = groupCalls([ok("a", 1), ok("b", 1), ok("c", 1), ok("d", 2), ok("e", 2)], byTurn);
    expect(ids(out)).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(out.every((e) => e.kind === "group")).toBe(true);
  });

  it("a call still in flight stays visible", () => {
    const running: C = { id: "run", turn: 1, name: "bash" };
    expect(isFlagged(running)).toBe(true);
    expect(ids(groupCalls([ok("a"), ok("b"), running], byTurn))).toEqual([["a", "b"], "run"]);
  });

  it("empty input gives empty output", () => {
    expect(groupCalls([], byTurn)).toEqual([]);
  });
});

describe("summarizeNames", () => {
  it("counts tool names, most frequent first", () => {
    expect(summarizeNames([{ name: "bash" }, { name: "read_file" }, { name: "read_file" }])).toBe("read_file ×2, bash");
    expect(summarizeNames([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }])).toBe("a, b, c, …");
  });
});
