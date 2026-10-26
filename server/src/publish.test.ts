import { describe, expect, it } from "vitest";
import { branchNameFor, prState, renderPrBody } from "./engine/publish.js";
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
