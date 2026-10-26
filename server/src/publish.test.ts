import { describe, expect, it } from "vitest";
import { branchNameFor, collectFeedback, prState, REINS_MARKER, renderFeedbackForBuilder, renderPrBody } from "./engine/publish.js";
import { DEFAULT_PUBLISH } from "../../shared/components.js";

const run = (name: string, conclusion: string, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const ctx = (context: string, state: string) => ({ __typename: "StatusContext", context, state });

describe("prState: what the harness does with a pull request's current view", () => {
  it("merged and closed are terminal", () => {
    expect(prState({ state: "MERGED" }, "approved")).toEqual({ kind: "merged" });
    expect(prState({ state: "CLOSED" }, "approved")).toEqual({ kind: "closed" });
  });

  it("a failing check run or status context names the checks", () => {
    expect(prState({ state: "OPEN", reviewDecision: "APPROVED", statusCheckRollup: [run("ci", "FAILURE"), ctx("lint", "ERROR"), run("build", "SUCCESS")] }, "approved")).toEqual({ kind: "failing", checks: ["ci", "lint"] });
    for (const c of ["TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]) expect(prState({ state: "OPEN", statusCheckRollup: [run("ci", c)] }, "checks").kind).toBe("failing");
  });

  it("pending checks mean waiting, whatever the review says", () => {
    expect(prState({ state: "OPEN", reviewDecision: "APPROVED", statusCheckRollup: [run("ci", "", "IN_PROGRESS")] }, "approved")).toEqual({ kind: "waiting", why: "checks pending: ci" });
    expect(prState({ state: "OPEN", statusCheckRollup: [ctx("deploy", "PENDING")] }, "checks")).toEqual({ kind: "waiting", why: "checks pending: deploy" });
  });

  it("approved needs an APPROVED review and green or absent checks; checks needs only green or absent checks", () => {
    expect(prState({ state: "OPEN", reviewDecision: "APPROVED", statusCheckRollup: [run("ci", "SUCCESS"), run("docs", "SKIPPED"), run("opt", "NEUTRAL")] }, "approved")).toEqual({ kind: "ready" });
    expect(prState({ state: "OPEN", reviewDecision: "APPROVED", statusCheckRollup: [] }, "approved")).toEqual({ kind: "ready" });
    expect(prState({ state: "OPEN", reviewDecision: "", statusCheckRollup: [run("ci", "SUCCESS")] }, "approved")).toEqual({ kind: "waiting", why: "no approving review yet" });
    expect(prState({ state: "OPEN", reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: [] }, "approved")).toEqual({ kind: "waiting", why: "changes requested" });
    expect(prState({ state: "OPEN", reviewDecision: "", statusCheckRollup: [run("ci", "SUCCESS")] }, "checks")).toEqual({ kind: "ready" });
    expect(prState({ state: "OPEN", statusCheckRollup: [] }, "checks")).toEqual({ kind: "ready" });
  });

  it("tolerates a view with fields missing", () => {
    expect(prState({}, "approved")).toEqual({ kind: "waiting", why: "no approving review yet" });
    expect(prState({ statusCheckRollup: null } as any, "checks")).toEqual({ kind: "ready" });
  });
});

describe("branch names and the PR body", () => {
  it("names the branch after the run, the package and a slug of its title", () => {
    expect(branchNameFor("abc123XYZ_", "P2", "Document the /health endpoint!")).toBe("reins/abc123xyz-p2-document-the-health-endpoint");
    expect(branchNameFor("", "P1", "x".repeat(80))).toBe(`reins/run-p1-${"x".repeat(40)}`);
  });

  it("the body says what the package is, what was agreed and verified, which tests were written, and what it was built on", () => {
    const body = renderPrBody({
      pkg: { id: "P1", title: "Health endpoint", features: ["F1"], rationale: "One change.", estimatedLines: 100, dependsOn: [] },
      features: [{ id: "F1", title: "GET /health route", status: "done" }],
      contract: [{ id: "C1", text: "GET /health responds 200", verify: "curl -s localhost:3000/health", hard: true }],
      evaluation: { results: [{ id: "C1", pass: true, evidence: "200 {\"status\":\"ok\"}" }], summary: "All pass." },
      testsDoc: "# Tests for this package\n\nTwo behaviour tests.",
      baseSha: "0123456789abcdef",
      base: "main",
      runId: "r1",
    });
    expect(body).toContain("## Work package P1: Health endpoint");
    expect(body).toContain("- F1: GET /health route");
    expect(body).toContain("One change.");
    expect(body).toContain("## Definition of done");
    expect(body).toContain("| C1 | hard | GET /health responds 200 | `curl -s localhost:3000/health` | PASS | 200 {\"status\":\"ok\"} |");
    expect(body).toContain("All pass.");
    expect(body).toContain("## Tests written first");
    expect(body).toContain("Two behaviour tests.");
    expect(body).toContain("Built on `main` at 0123456 by Reins run r1.");
    expect(body).not.toContain("# Tests for this package");
  });

  it("DEFAULT_PUBLISH waits for an approving review, squashes, polls every minute and gives up after four hours", () => {
    expect(DEFAULT_PUBLISH).toEqual({ remote: "origin", mergeWhen: "approved", mergeMethod: "squash", pollSeconds: 60, maxWaitMinutes: 240, maxReviewRounds: 3 });
  });
});

describe("review feedback", () => {
  const since = "2026-05-01T00:00:00Z";
  const view = {
    comments: [
      { author: { login: "ana" }, body: "Please rename x to count.", createdAt: "2026-05-01T00:01:00Z", url: "https://example.test/c/1" },
      { author: { login: "old" }, body: "Earlier remark.", createdAt: "2026-04-30T00:00:00Z", url: "https://example.test/c/0" },
      { author: { login: "reins-bot" }, body: REINS_MARKER + "\nAddressed the rename.", createdAt: "2026-05-01T00:02:00Z", url: "https://example.test/c/2" },
    ],
    reviews: [
      { author: { login: "bo" }, state: "CHANGES_REQUESTED", body: "Needs a test for the empty case.", submittedAt: "2026-05-01T00:03:00Z" },
      { author: { login: "cy" }, state: "APPROVED", body: "", submittedAt: "2026-05-01T00:04:00Z" },
      { author: { login: "bo" }, state: "COMMENTED", body: "Old note", submittedAt: "2026-04-01T00:00:00Z" },
    ],
  };
  const inline = [
    { user: { login: "ana" }, path: "src/x.ts", line: 12, body: "Off by one here.", created_at: "2026-05-01T00:05:00Z", html_url: "https://example.test/i/12" },
    { user: { login: "ana" }, path: "src/y.ts", original_line: 3, body: "Stale.", created_at: "2026-04-01T00:00:00Z", html_url: "https://example.test/i/3" },
  ];

  it("keeps only what arrived after `since`, drops the harness's own comments and empty reviews, and orders by time", () => {
    const items = collectFeedback(view, inline, since);
    expect(items.map((i) => [i.kind, i.author, i.body, i.path, i.line])).toEqual([
      ["comment", "ana", "Please rename x to count.", undefined, undefined],
      ["review", "bo", "Needs a test for the empty case.", undefined, undefined],
      ["inline", "ana", "Off by one here.", "src/x.ts", 12],
    ]);
    expect(items[1].state).toBe("CHANGES_REQUESTED");
    expect(collectFeedback({}, [], since)).toEqual([]);
    expect(collectFeedback({ comments: null, reviews: undefined } as any, null as any, since)).toEqual([]);
  });

  it("renders the builder's brief: each item with who, where and what, then the failing checks", () => {
    const text = renderFeedbackForBuilder(collectFeedback(view, inline, since), [{ name: "ci", bucket: "fail", link: "https://example.test/checks/ci", description: "2 tests failed" }], "https://example.test/pr/4");
    expect(text).toContain("Pull request: https://example.test/pr/4");
    expect(text).toContain("- @ana commented: Please rename x to count.");
    expect(text).toContain("- @bo requested changes: Needs a test for the empty case.");
    expect(text).toContain("- @ana on src/x.ts:12: Off by one here.");
    expect(text).toContain("Failing checks:\n- ci (fail): 2 tests failed — https://example.test/checks/ci");
    expect(text).toMatch(/Address every item: change the code, or say in your summary why not/);
    expect(text).toMatch(/Do not weaken or delete tests to make a check pass/);
  });
});
