import { describe, expect, it } from "vitest";
import { PACKAGE_MAX_LINES, renderBreakdown, singlePackage, validateBreakdown } from "../../shared/packages.js";
import type { FeatureItem } from "../../shared/types.js";

const features: FeatureItem[] = [
  { id: "F1", title: "GET /health route", status: "todo" },
  { id: "F2", title: "Health test", status: "todo" },
  { id: "F3", title: "README section", status: "todo" },
];

const good = {
  packages: [
    { id: "P1", title: "Health endpoint with its test", features: ["F1", "F2"], rationale: "The route and its test are one reviewable change.", estimated_lines: 120, depends_on: [] },
    { id: "P2", title: "Document the endpoint", features: ["F3"], rationale: "Docs follow the behaviour they describe.", estimated_lines: 30, depends_on: ["P1"] },
  ],
  rationale: "Two small pull requests.",
};

describe("validateBreakdown", () => {
  it("accepts a good breakdown and normalises the tool's snake_case fields", () => {
    const r = validateBreakdown(good.packages, features);
    expect(r.problems).toEqual([]);
    expect(r.packages).toEqual([
      { id: "P1", title: "Health endpoint with its test", features: ["F1", "F2"], rationale: "The route and its test are one reviewable change.", estimatedLines: 120, dependsOn: [] },
      { id: "P2", title: "Document the endpoint", features: ["F3"], rationale: "Docs follow the behaviour they describe.", estimatedLines: 30, dependsOn: ["P1"] },
    ]);
  });

  it("accepts the camelCase form too (a hand-edited packages.json)", () => {
    const r = validateBreakdown([{ id: "P1", title: "All", features: ["F1", "F2", "F3"], rationale: "r", estimatedLines: 50 }], features);
    expect(r.problems).toEqual([]);
    expect(r.packages[0]).toMatchObject({ estimatedLines: 50, dependsOn: [] });
  });

  it("refuses anything that is not a non-empty list of packages", () => {
    expect(validateBreakdown(null, features).problems[0]).toMatch(/at least one package/);
    expect(validateBreakdown([], features).problems[0]).toMatch(/at least one package/);
    expect(validateBreakdown("P1", features).problems[0]).toMatch(/at least one package/);
  });

  it("every feature lands in exactly one package: missing, duplicated and unknown ids are named", () => {
    const r = validateBreakdown(
      [
        { id: "P1", title: "a", features: ["F1", "F2"], rationale: "r", estimated_lines: 10 },
        { id: "P2", title: "b", features: ["F2", "F9"], rationale: "r", estimated_lines: 10 },
      ],
      features,
    );
    expect(r.problems).toEqual([expect.stringMatching(/F9.*not in the feature list/), expect.stringMatching(/F2.*more than one package.*P1, P2/), expect.stringMatching(/F3.*no package/)]);
  });

  it("caps each package at PACKAGE_MAX_LINES changed lines and says to split", () => {
    const r = validateBreakdown([{ id: "P1", title: "Everything", features: ["F1", "F2", "F3"], rationale: "r", estimated_lines: 900 }], features);
    expect(PACKAGE_MAX_LINES).toBe(400);
    expect(r.problems).toEqual([expect.stringMatching(/P1 estimates 900 changed lines.*at most 400.*[Ss]plit/)]);
    expect(validateBreakdown([{ id: "P1", title: "Everything", features: ["F1", "F2", "F3"], rationale: "r", estimated_lines: 900 }], features, { maxLines: 1000 }).problems).toEqual([]);
  });

  it("requires an id, a title, a rationale and a positive line estimate on every package", () => {
    const r = validateBreakdown([{ id: "", title: "", features: ["F1", "F2", "F3"], rationale: "", estimated_lines: 0 }], features);
    expect(r.problems).toEqual([expect.stringMatching(/package 1 has no id/), expect.stringMatching(/has no title/), expect.stringMatching(/has no rationale/), expect.stringMatching(/positive number of changed lines/)]);
  });

  it("refuses duplicate ids and dependencies that are unknown, on itself or on a later package", () => {
    const r = validateBreakdown(
      [
        { id: "P1", title: "a", features: ["F1"], rationale: "r", estimated_lines: 10, depends_on: ["P3"] },
        { id: "P1", title: "b", features: ["F2"], rationale: "r", estimated_lines: 10, depends_on: ["P1"] },
        { id: "P3", title: "c", features: ["F3"], rationale: "r", estimated_lines: 10, depends_on: ["P7"] },
      ],
      features,
    );
    expect(r.problems).toEqual([
      expect.stringMatching(/P1 depends on P3, which comes later/),
      expect.stringMatching(/id P1 is used twice/),
      expect.stringMatching(/P1 depends on itself/),
      expect.stringMatching(/P3 depends on P7, which is not a package/),
    ]);
  });

  it("refuses a package with no features", () => {
    const r = validateBreakdown(
      [
        { id: "P1", title: "a", features: [], rationale: "r", estimated_lines: 10 },
        { id: "P2", title: "b", features: ["F1", "F2", "F3"], rationale: "r", estimated_lines: 10 },
      ],
      features,
    );
    expect(r.problems).toEqual([expect.stringMatching(/P1 has no features/)]);
  });
});

describe("singlePackage and renderBreakdown", () => {
  it("wraps the whole feature list in one package named after the run", () => {
    expect(singlePackage("Add a health endpoint", features)).toEqual([{ id: "P1", title: "Add a health endpoint", features: ["F1", "F2", "F3"], rationale: "The whole task as one package.", estimatedLines: 0, dependsOn: [] }]);
  });

  it("renders each package with its features' titles for a first message", () => {
    const text = renderBreakdown(validateBreakdown(good.packages, features).packages, features);
    expect(text).toBe(["- P1: Health endpoint with its test (~120 lines)", "    F1: GET /health route", "    F2: Health test", "    why: The route and its test are one reviewable change.", "- P2: Document the endpoint (~30 lines; after P1)", "    F3: README section", "    why: Docs follow the behaviour they describe."].join("\n"));
  });
});
