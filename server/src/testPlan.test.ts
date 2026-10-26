import { describe, expect, it } from "vitest";
import { renderTestPlanDoc, renderTestsForBuilder, testsCriterion, TESTS_CRITERION_ID, validateTestPlan } from "../../shared/testPlan.js";
import type { ContractCriterion } from "../../shared/types.js";

const contract: ContractCriterion[] = [
  { id: "C1", text: "GET /health responds 200", verify: "curl -s localhost:3000/health", hard: true },
  { id: "C2", text: "Unknown paths return JSON 404", verify: "curl -s localhost:3000/nope", hard: true },
  { id: "C3", text: "README documents the endpoint", verify: "grep health README.md", hard: false },
];
const exists = (f: string) => f.startsWith("test/");
const good = {
  command: "npm test -- health",
  tests: [
    { id: "T1", file: "test/health.test.ts", name: "responds 200 with status and uptime", criteria: ["C1"], kind: "behavior", explains: "Starts the server and requests /health; proves C1 end to end." },
    { id: "T2", file: "test/health.test.ts", name: "unknown path is a JSON 404", criteria: ["C2"], kind: "behavior", explains: "The failure path C2 names: the body must be JSON, not the default HTML page." },
  ],
  uncovered: [{ id: "C3", reason: "Documentation is checked by the evaluator's grep; a test would duplicate it." }],
  explanation: "Two behaviour tests through the real HTTP interface, no mocks.",
};

describe("validateTestPlan", () => {
  it("accepts a plan that covers every hard criterion with tests in files that exist", () => {
    const r = validateTestPlan(good, contract, exists);
    expect(r.problems).toEqual([]);
    expect(r.plan).toEqual({
      command: "npm test -- health",
      tests: [
        { id: "T1", file: "test/health.test.ts", name: "responds 200 with status and uptime", criteria: ["C1"], kind: "behavior", explains: "Starts the server and requests /health; proves C1 end to end." },
        { id: "T2", file: "test/health.test.ts", name: "unknown path is a JSON 404", criteria: ["C2"], kind: "behavior", explains: "The failure path C2 names: the body must be JSON, not the default HTML page." },
      ],
      uncovered: [{ id: "C3", reason: "Documentation is checked by the evaluator's grep; a test would duplicate it." }],
      explanation: "Two behaviour tests through the real HTTP interface, no mocks.",
    });
  });

  it("requires a command and at least one test", () => {
    expect(validateTestPlan({ command: "", tests: [], explanation: "x" }, contract, exists).problems).toEqual([expect.stringMatching(/command that runs the new tests/), expect.stringMatching(/at least one test/)]);
    expect(validateTestPlan(null, contract, exists).problems[0]).toMatch(/command/);
  });

  it("names every hard criterion that no test covers and no uncovered entry explains", () => {
    const r = validateTestPlan({ ...good, tests: [good.tests[0]], uncovered: [] }, contract, exists);
    expect(r.problems).toEqual([expect.stringMatching(/C2 .*not covered by any test/)]);
    // a soft criterion may go uncovered silently; a hard one needs a reason
    expect(validateTestPlan({ ...good, tests: [good.tests[0]], uncovered: [{ id: "C2", reason: "needs a browser" }] }, contract, exists).problems).toEqual([]);
    expect(validateTestPlan({ ...good, tests: [good.tests[0]], uncovered: [{ id: "C2", reason: "" }] }, contract, exists).problems).toEqual([expect.stringMatching(/C2 .*reason/)]);
  });

  it("refuses tests whose file is missing, whose criteria are unknown, or that lack an id, name or explanation", () => {
    const r = validateTestPlan(
      {
        command: "npm test",
        tests: [
          { id: "", file: "src/none.test.ts", name: "", criteria: ["C9"], kind: "unit", explains: "" },
          { id: "T2", file: "test/a.test.ts", name: "b", criteria: [], kind: "unit", explains: "e" },
        ],
        explanation: "x",
      },
      contract,
      exists,
    );
    expect(r.problems).toEqual([
      expect.stringMatching(/test 1 has no id/),
      expect.stringMatching(/test 1 has no name/),
      expect.stringMatching(/test 1 does not say what it checks/),
      expect.stringMatching(/src\/none\.test\.ts does not exist.*write the test file first/),
      expect.stringMatching(/test 1 cites C9, which is not a contract criterion/),
      expect.stringMatching(/T2 covers no criterion/),
      expect.stringMatching(/C1 .*not covered/),
      expect.stringMatching(/C2 .*not covered/),
    ]);
  });

  it("refuses duplicate test ids and an unknown kind", () => {
    const r = validateTestPlan({ ...good, tests: [good.tests[0], { ...good.tests[1], id: "T1", kind: "vibes" }] }, contract, exists);
    expect(r.problems).toEqual([expect.stringMatching(/id T1 is used twice/), expect.stringMatching(/T1 has kind "vibes".*unit, behavior, integration, e2e/)]);
  });
});

describe("the tests criterion and the briefs", () => {
  it("adds one hard criterion whose verification is the test command", () => {
    expect(TESTS_CRITERION_ID).toBe("T");
    expect(testsCriterion("npm test -- health")).toEqual({ id: "T", text: "The tests written in the tests stage pass (npm test -- health)", verify: "npm test -- health", hard: true });
  });

  it("renders the builder brief: the command, each test with what it proves, and the rules", () => {
    const plan = validateTestPlan(good, contract, exists).plan;
    const text = renderTestsForBuilder(plan);
    expect(text).toContain("Run: npm test -- health");
    expect(text).toContain("- T1 (behavior, test/health.test.ts) responds 200 with status and uptime [C1]: Starts the server");
    expect(text).toContain("- T2 (behavior, test/health.test.ts) unknown path is a JSON 404 [C2]:");
    expect(text).toMatch(/Do not modify, weaken, skip or delete these tests/);
    expect(text).toMatch(/If a test is wrong, say so in your progress note and list it in open_items/);
  });

  it("renders .reins/tests.md with the explanation, the red run and every test", () => {
    const plan = validateTestPlan(good, contract, exists).plan;
    const md = renderTestPlanDoc(plan, { exitCode: 1, excerpt: "FAIL test/health.test.ts\n  2 failed" });
    expect(md).toMatch(/^# Tests for this package\n/);
    expect(md).toContain("Two behaviour tests through the real HTTP interface, no mocks.");
    expect(md).toContain("`npm test -- health`");
    expect(md).toContain("exit 1");
    expect(md).toContain("2 failed");
    expect(md).toContain("## T1");
    expect(md).toContain("Covers: C1");
    expect(md).toContain("## Not covered by a test\n- C3: Documentation is checked");
  });
});
