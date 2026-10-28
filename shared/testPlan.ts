// Tests first: the tests stage turns a package's contract into failing tests
// before any code is written. Pure: the orchestrator validates the writer's
// proposal with it, the builder and evaluator briefs are rendered with it, and
// the web UI and vitest share it.
import type { ContractCriterion, TestPlan, TestSpec } from "./types.js";
import { isObj, str } from "./util.js";

export const TEST_KINDS: TestSpec["kind"][] = ["unit", "behavior", "integration", "e2e"];
/** The contract criterion the tests stage adds: the suite it wrote must pass. */
export const TESTS_CRITERION_ID = "T";

/**
 * Check a proposed test plan against the contract. Every hard criterion must be
 * covered by a test or listed as uncovered with a reason; every test file must
 * exist (the writer writes the files, then proposes). Problems are one
 * actionable sentence each; `plan` is only meaningful when there are none.
 */
export function validateTestPlan(raw: unknown, contract: ContractCriterion[], exists: (file: string) => boolean): { plan: TestPlan; problems: string[] } {
  const problems: string[] = [];
  const o = isObj(raw) ? raw : {};
  const command = str(o.command);
  if (!command) problems.push("Give the command that runs the new tests (and only them where the project allows it), e.g. npm test -- health.");
  const rawTests = Array.isArray(o.tests) ? o.tests : [];
  if (!rawTests.length) problems.push("Propose at least one test; every hard criterion needs one.");
  const known = new Set(contract.map((c) => c.id));
  const covered = new Set<string>();
  const ids = new Set<string>();
  const tests: TestSpec[] = [];
  rawTests.forEach((t, i) => {
    const x = isObj(t) ? t : {};
    const id = str(x.id);
    const name = id || `test ${i + 1}`;
    if (!id) problems.push(`test ${i + 1} has no id (use T1, T2, ...).`);
    else if (ids.has(id)) problems.push(`id ${id} is used twice; every test needs its own id.`);
    ids.add(id);
    if (!str(x.name)) problems.push(`${name} has no name.`);
    if (!str(x.explains)) problems.push(`${name} does not say what it checks and why (explains).`);
    const file = str(x.file);
    if (!file) problems.push(`${name} names no file.`);
    else if (!exists(file)) problems.push(`${file} does not exist in the workspace; write the test file first, then propose.`);
    const kind = str(x.kind) as TestSpec["kind"];
    if (kind && !TEST_KINDS.includes(kind)) problems.push(`${name} has kind "${kind}"; use one of ${TEST_KINDS.join(", ")}.`);
    const crit = Array.isArray(x.criteria) ? x.criteria.map(str).filter(Boolean) : [];
    for (const c of crit) {
      if (!known.has(c)) problems.push(`${name} cites ${c}, which is not a contract criterion (${[...known].join(", ")}).`);
      else covered.add(c);
    }
    if (!crit.length) problems.push(`${name} covers no criterion; every test proves at least one.`);
    tests.push({ id, file, name: str(x.name), criteria: crit, kind: TEST_KINDS.includes(kind) ? kind : "behavior", explains: str(x.explains) });
  });
  const uncovered: TestPlan["uncovered"] = [];
  for (const u of Array.isArray(o.uncovered) ? o.uncovered : []) {
    const y = isObj(u) ? u : {};
    const id = str(y.id);
    if (!id || !known.has(id)) continue;
    const reason = str(y.reason);
    if (!reason) problems.push(`${id} is listed as uncovered without a reason; say why no test can check it here.`);
    uncovered.push({ id, reason });
  }
  for (const c of rawTests.length ? contract : []) {
    if (!c.hard || covered.has(c.id) || uncovered.some((u) => u.id === c.id && u.reason)) continue;
    if (uncovered.some((u) => u.id === c.id)) continue; // already reported: no reason
    problems.push(`${c.id} (${c.text}) is a hard criterion not covered by any test; add one, or list it under uncovered with the reason.`);
  }
  return { plan: { command, tests, uncovered, explanation: str(o.explanation) }, problems };
}

export function testsCriterion(command: string): ContractCriterion {
  return { id: TESTS_CRITERION_ID, text: `The tests written in the tests stage pass (${command})`, verify: command, hard: true };
}

const testLine = (t: TestSpec) => `- ${t.id} (${t.kind}, ${t.file}) ${t.name} [${t.criteria.join(", ")}]: ${t.explains}`;

/** The builder's "Tests to make pass" section. */
export function renderTestsForBuilder(plan: TestPlan): string {
  return [
    `Run: ${plan.command}`,
    "These tests were written before your work and fail now; your work is done when they pass for the right reasons.",
    ...plan.tests.map(testLine),
    "Do not modify, weaken, skip or delete these tests, and do not special-case the code to them. If a test is wrong, say so in your progress note and list it in open_items when you finish; the evaluator decides.",
  ].join("\n");
}

/** .reins/tests.md: the explanation a reviewer reads, with the red run as evidence. */
export function renderTestPlanDoc(plan: TestPlan, red: { exitCode: number | null; excerpt: string }): string {
  const out = [
    "# Tests for this package",
    "",
    plan.explanation,
    "",
    `Run with \`${plan.command}\`. Before the build the suite was red (exit ${red.exitCode ?? "none"}):`,
    "",
    "```",
    red.excerpt.trim(),
    "```",
    "",
  ];
  for (const t of plan.tests) out.push(`## ${t.id}: ${t.name}`, "", `File: ${t.file} (${t.kind}). Covers: ${t.criteria.join(", ")}.`, "", t.explains, "");
  if (plan.uncovered.length) out.push("## Not covered by a test", ...plan.uncovered.map((u) => `- ${u.id}: ${u.reason}`), "");
  return out.join("\n");
}
