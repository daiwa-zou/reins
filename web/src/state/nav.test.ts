import { describe, expect, it } from "vitest";
import { DEFAULT_NAV, DETAILS_SUBS, RUN_VIEWS, SECTIONS, SHORTCUTS, applyNavAction, decodeNav, encodeNav, keyForSection, normalizeNav, sameNav, shortcutFor, type NavState } from "./nav";

describe("nav URL round-trip", () => {
  it("round-trips every section × view × sub combination with a run", () => {
    for (const s of SECTIONS)
      for (const v of RUN_VIEWS)
        for (const d of DETAILS_SUBS) {
          const state: NavState = { section: s.id, run: "abc123XYZ_", view: v.id, sub: d.id };
          const back = decodeNav(encodeNav(state));
          expect(back).toEqual(normalizeNav(state));
          // Details keeps its sub-view; the other views have none.
          if (v.id === "details") expect(back).toEqual(state);
          else expect(back).toEqual({ ...state, sub: "transcript" });
        }
  });

  it("round-trips every section with no run", () => {
    for (const s of SECTIONS) {
      const state: NavState = { section: s.id, run: null, view: "activity", sub: "transcript" };
      expect(decodeNav(encodeNav(state))).toEqual(state);
    }
  });

  it("encodes the defaults as an empty query and omits default values", () => {
    expect(encodeNav(DEFAULT_NAV)).toBe("");
    expect(encodeNav({ section: "runs", run: "r1", view: "activity", sub: "transcript" })).toBe("?run=r1");
    expect(encodeNav({ section: "runs", run: "r1", view: "details", sub: "guardrails" })).toBe("?run=r1&view=details&sub=guardrails");
    expect(encodeNav({ section: "harness", run: null, view: "activity", sub: "transcript" })).toBe("?section=harness");
  });
});

describe("nav defaults and legacy links", () => {
  it("an empty query gives the Runs section, Activity view, Transcript sub", () => {
    for (const q of ["", "?", undefined, null]) expect(decodeNav(q as string)).toEqual({ section: "runs", run: null, view: "activity", sub: "transcript" });
  });

  it("legacy ?run=<id> opens that run on Activity", () => {
    expect(decodeNav("?run=Kq3_x-9aZ")).toEqual({ section: "runs", run: "Kq3_x-9aZ", view: "activity", sub: "transcript" });
    expect(decodeNav("run=Kq3_x-9aZ")).toEqual({ section: "runs", run: "Kq3_x-9aZ", view: "activity", sub: "transcript" });
  });
});

describe("nav failure path: garbage decodes to safe defaults", () => {
  it("unknown section, view and sub fall back without throwing", () => {
    expect(() => decodeNav("?section=nope&view=bogus&sub=zzz")).not.toThrow();
    expect(decodeNav("?section=nope&view=bogus&sub=zzz")).toEqual(DEFAULT_NAV);
    expect(decodeNav("?section=nope")).toEqual(DEFAULT_NAV);
  });

  it("an unknown view with a valid run falls back to Activity for that run", () => {
    expect(decodeNav("?run=r1&view=bogus&sub=zzz")).toEqual({ section: "runs", run: "r1", view: "activity", sub: "transcript" });
  });

  it("an unknown sub on Details falls back to Transcript", () => {
    expect(decodeNav("?run=r1&view=details&sub=zzz")).toEqual({ section: "runs", run: "r1", view: "details", sub: "transcript" });
  });

  it("empty-string values fall back to defaults", () => {
    expect(() => decodeNav("?section=&run=&view=&sub=")).not.toThrow();
    expect(decodeNav("?section=&run=&view=&sub=")).toEqual(DEFAULT_NAV);
    expect(decodeNav("?run=%20%20")).toEqual(DEFAULT_NAV);
  });

  it("a view or sub without a run is dropped", () => {
    expect(decodeNav("?view=contract")).toEqual(DEFAULT_NAV);
    expect(decodeNav("?view=details&sub=guardrails")).toEqual(DEFAULT_NAV);
    expect(decodeNav("?section=harness&view=changes")).toEqual({ ...DEFAULT_NAV, section: "harness" });
  });

  it("a run that does not exist is dropped, as is a malformed id", () => {
    const runExists = (id: string) => id === "known";
    expect(decodeNav("?run=missing&view=contract", { runExists })).toEqual(DEFAULT_NAV);
    expect(decodeNav("?run=known&view=contract", { runExists })).toEqual({ ...DEFAULT_NAV, run: "known", view: "contract" });
    expect(decodeNav("?run=" + encodeURIComponent("<script>alert(1)</script>"))).toEqual(DEFAULT_NAV);
    expect(decodeNav("?run=" + "x".repeat(500))).toEqual(DEFAULT_NAV);
  });

  it("a throwing runExists does not escape", () => {
    expect(decodeNav("?run=r1", { runExists: () => { throw new Error("boom"); } })).toEqual(DEFAULT_NAV);
  });

  it("duplicate and junk parameters are tolerated", () => {
    expect(decodeNav("?run=r1&run=r2&view=changes&view=bogus&foo=bar&%zz")).toEqual({ ...DEFAULT_NAV, run: "r1", view: "changes" });
  });

  it("encode tolerates garbage state", () => {
    expect(encodeNav({ section: "nope" as never, run: "", view: "bogus" as never, sub: "zzz" as never })).toBe("");
  });
});

describe("shortcut map", () => {
  it("maps 1–4 to the four run views", () => {
    expect(shortcutFor("1")?.action).toEqual({ type: "view", view: "activity" });
    expect(shortcutFor("2")?.action).toEqual({ type: "view", view: "contract" });
    expect(shortcutFor("3")?.action).toEqual({ type: "view", view: "changes" });
    expect(shortcutFor("4")?.action).toEqual({ type: "view", view: "details" });
  });

  it("documents exactly one key per app section", () => {
    for (const s of SECTIONS) {
      const hits = SHORTCUTS.filter((x) => x.action.type === "section" && x.action.section === s.id);
      expect(hits).toHaveLength(1);
      expect(keyForSection(s.id)).toBe(hits[0].display);
    }
    expect(shortcutFor("r")?.action).toEqual({ type: "section", section: "runs" });
    expect(shortcutFor("t")?.action).toEqual({ type: "section", section: "reliability" });
    expect(shortcutFor("h")?.action).toEqual({ type: "section", section: "harness" });
    expect(shortcutFor("l")?.action).toEqual({ type: "section", section: "lessons" });
  });

  it("keeps n, d, ? and space for their existing actions", () => {
    expect(shortcutFor("n")?.action.type).toBe("newRun");
    expect(shortcutFor("d")?.action.type).toBe("demo");
    expect(shortcutFor("?")?.action.type).toBe("help");
    expect(shortcutFor(" ")?.action.type).toBe("pauseResume");
  });

  it("has no duplicate keys, and no section key reuses n, d, ?, space or 1–4", () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const reserved = new Set(["n", "d", "?", " ", "1", "2", "3", "4"]);
    for (const s of SHORTCUTS.filter((x) => x.action.type === "section")) expect(reserved.has(s.key)).toBe(false);
  });

  it("unbound keys map to nothing", () => {
    expect(shortcutFor("5")).toBeUndefined();
    expect(shortcutFor("x")).toBeUndefined();
  });

  it("applying a view shortcut needs a run; with none it is a no-op", () => {
    const none = { ...DEFAULT_NAV, section: "harness" as const };
    expect(applyNavAction(none, { type: "view", view: "contract" })).toEqual(none);
    const withRun: NavState = { ...DEFAULT_NAV, section: "lessons", run: "r1" };
    expect(applyNavAction(withRun, { type: "view", view: "contract" })).toEqual({ ...DEFAULT_NAV, run: "r1", view: "contract" });
    expect(applyNavAction(withRun, { type: "section", section: "reliability" })).toEqual({ ...withRun, section: "reliability" });
    expect(applyNavAction(withRun, { type: "help" })).toBeNull();
  });
});

describe("nav: lessons and harness deep links", () => {
  it("round-trips the selected lesson slug", () => {
    const state: NavState = { section: "lessons", run: null, view: "activity", sub: "transcript", lesson: "claude-think-tool" };
    expect(encodeNav(state)).toBe("?section=lessons&lesson=claude-think-tool");
    expect(decodeNav(encodeNav(state))).toEqual(state);
    // With a run selected and a component filter too.
    const withRun: NavState = { section: "lessons", run: "r1", view: "activity", sub: "transcript", lesson: "agent-skills", component: "skills" };
    expect(decodeNav(encodeNav(withRun))).toEqual(withRun);
  });

  it("round-trips a focused Harness card", () => {
    const state: NavState = { section: "harness", run: null, view: "activity", sub: "transcript", component: "thinkTool" };
    expect(decodeNav(encodeNav(state))).toEqual(state);
  });

  it("decode tolerates a garbage slug or component and falls back to the list", () => {
    for (const q of ["?section=lessons&lesson=..%2F..%2Fetc%2Fhosts", "?section=lessons&lesson=%00%ff", "?section=lessons&lesson=", "?section=lessons&lesson=.hidden", `?section=lessons&lesson=${"a".repeat(500)}`]) {
      expect(() => decodeNav(q)).not.toThrow();
      expect(decodeNav(q)).toEqual({ section: "lessons", run: null, view: "activity", sub: "transcript" });
    }
    expect(decodeNav("?section=lessons&component=notAComponent")).toEqual({ section: "lessons", run: null, view: "activity", sub: "transcript" });
  });

  it("drops lesson and component outside their sections", () => {
    expect(decodeNav("?section=runs&lesson=agent-skills&component=thinkTool")).toEqual({ section: "runs", run: null, view: "activity", sub: "transcript" });
    expect(decodeNav("?section=harness&lesson=agent-skills")).toEqual({ section: "harness", run: null, view: "activity", sub: "transcript" });
  });

  it("round-trips a focused Harness skill row (lesson skill links) and keeps it Harness-only", () => {
    const state: NavState = { section: "harness", run: null, view: "activity", sub: "transcript", skill: "writing-a-contract" };
    expect(encodeNav(state)).toBe("?section=harness&skill=writing-a-contract");
    expect(decodeNav(encodeNav(state))).toEqual(state);
    expect(sameNav(state, { ...state, skill: "verify-like-a-user" })).toBe(false);
    expect(sameNav(state, { ...state })).toBe(true);
    // Outside Harness, or garbage, the skill param is dropped.
    expect(decodeNav("?section=lessons&skill=writing-a-contract")).toEqual({ section: "lessons", run: null, view: "activity", sub: "transcript" });
    for (const q of ["?section=harness&skill=..%2Fetc", "?section=harness&skill=", `?section=harness&skill=${"a".repeat(200)}`, "?section=harness&skill=%00"]) {
      expect(() => decodeNav(q)).not.toThrow();
      expect(decodeNav(q)).toEqual({ section: "harness", run: null, view: "activity", sub: "transcript" });
    }
  });

  it("a stage target focuses the stageLessons component card", () => {
    const state: NavState = { section: "harness", run: null, view: "activity", sub: "transcript", component: "stageLessons" };
    expect(decodeNav(encodeNav(state))).toEqual(state);
  });
});
