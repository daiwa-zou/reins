import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Implication, Lesson, UserDomain } from "../../shared/types.js";
import { domainEffects, slugifyDomainId, tagUserDomains, validateUserDomain } from "../../shared/domains.js";
import { composeRun, domainPresets, PRESET_RECIPES } from "../../shared/presets.js";
import { seededHome } from "./testLibrary.js";

// A user-built domain is a named set of implications picked from the library.
// Picking an implication tags it with the domain: stage implications feed the
// stage blocks, component implications switch the component on, the rest become
// guidance lines. The source lesson's own enables/disables/guidance do not come
// along: only what was picked.

const impl = (lesson: string, n: number, kind: Implication["kind"], target: string | undefined, claim: string, extra: Partial<Implication> = {}): Implication => ({ id: `${lesson}#${n}`, lesson, date: "2026-01-01", kind, target, claim, quote: "q", domains: [], standing: "bundled", ...extra });
const lesson = (slug: string, items: Implication[], extra: Partial<Lesson> = {}): Lesson => ({ slug, title: `Lesson ${slug}`, date: "2026-01-01", url: "", takeaway: "t", learnings: ["l"], implications: items.map((i) => i.claim), components: [], foundations: [], tags: [], source: "bundled", items, standing: "bundled", ...extra });

const web = lesson("webby", [impl("webby", 1, "stage", "build", "Start the dev server with a timeout before testing.", { domains: ["web"] }), impl("webby", 2, "component", "thinkTool", "Pause to think before irreversible steps."), impl("webby", 3, "foundation", "eventLog", "Keep the log append-only."), impl("webby", 4, "component", "compaction", "Summarise old history."), impl("webby", 5, "effort", "high", "Web work wants a contract.", { domains: ["web"] })], { domains: ["web"], enables: ["scouts"], guidance: "Hit real endpoints." });
const draft = lesson("draft", [impl("draft", 1, "stage", "evaluate", "Not yet reviewed.", { standing: "unreviewed" })], { source: "user", standing: "unreviewed" });
const lessons = [web, draft];
const mine: UserDomain = { id: "my-stack", label: "My stack", description: "What I care about.", implications: ["webby#1", "webby#2", "webby#3", "webby#4", "webby#5"] };

describe("validateUserDomain", () => {
  const reserved = ["web", "cli", "golang", "python"];
  it("accepts a good domain, dedupes implications and keeps only known fields", () => {
    const r = validateUserDomain({ id: "my-stack", label: " My stack ", description: "d", implications: ["webby#1", "webby#2", "webby#1"], extra: 1 }, lessons, reserved);
    expect(r.problems).toEqual([]);
    expect(r.domain).toEqual({ id: "my-stack", label: "My stack", description: "d", implications: ["webby#1", "webby#2"] });
  });
  it("derives the id from the label when none is given", () => {
    expect(slugifyDomainId("My Stack! v2")).toBe("my-stack-v2");
    expect(validateUserDomain({ label: "My Stack", implications: ["webby#1"] }, lessons, reserved).domain.id).toBe("my-stack");
  });
  it("names every problem: bad id, reserved id, missing label, no or unknown implications, unreviewed ones", () => {
    expect(validateUserDomain({ id: "My Stack", label: "x", implications: ["webby#1"] }, lessons, reserved).problems).toEqual([expect.stringMatching(/id "My Stack".*lowercase letters, digits and dashes/)]);
    expect(validateUserDomain({ id: "web", label: "x", implications: ["webby#1"] }, lessons, reserved).problems).toEqual([expect.stringMatching(/"web" is already a domain/)]);
    expect(validateUserDomain({ id: "ok", label: "", implications: ["webby#1"] }, lessons, reserved).problems).toEqual([expect.stringMatching(/label/)]);
    expect(validateUserDomain({ id: "ok", label: "x", implications: [] }, lessons, reserved).problems).toEqual([expect.stringMatching(/at least one implication/)]);
    expect(validateUserDomain({ id: "ok", label: "x", implications: ["nope#9", "draft#1"] }, lessons, reserved).problems).toEqual([expect.stringMatching(/nope#9.*not in the library/), expect.stringMatching(/draft#1.*unreviewed/)]);
    expect(validateUserDomain(null, lessons, reserved).problems.length).toBeGreaterThan(0);
  });
});

describe("tagUserDomains and domainEffects", () => {
  it("tags only the picked implications with the domain id and leaves other lessons untouched", () => {
    const tagged = tagUserDomains(lessons, [{ ...mine, implications: ["webby#1", "webby#2"] }]);
    expect(tagged[0].items.map((i) => i.domains)).toEqual([["web", "my-stack"], ["my-stack"], [], [], ["web"]]);
    expect(tagged[1]).toBe(draft);
    expect(tagUserDomains(lessons, [])).toBe(lessons);
    expect(web.items[1].domains).toEqual([]); // the originals are not mutated
  });
  it("sorts the picked implications into what they do: switch on, stage line, guidance, or ignored with the reason", () => {
    const fx = domainEffects(mine, lessons);
    expect(fx.enables).toEqual(["thinkTool"]);
    expect(fx.stages).toEqual({ build: ["Start the dev server with a timeout before testing."] });
    expect(fx.guidance).toEqual(["Keep the log append-only."]);
    expect(fx.ignored).toEqual([expect.stringMatching(/webby#4.*Compaction is always on/), expect.stringMatching(/webby#5.*effort recommendations are shown, never applied/)]);
    expect(fx.items.map((i) => i.id)).toEqual(["webby#1", "webby#2", "webby#3", "webby#4", "webby#5"]);
    expect(fx.lessons).toEqual(["webby"]);
  });
});

describe("composing a run with a user-built domain", () => {
  it("applies the picked implications and nothing else from their lessons", () => {
    const c = composeRun({ effort: "medium", supervision: "check-in", domains: ["my-stack"] }, lessons, PRESET_RECIPES, undefined, [mine]);
    expect(c.domains).toEqual(["my-stack"]);
    expect(c.config.components!.thinkTool).toBe(true);
    expect(c.config.components!.scouts).toBe(false); // the lesson's own enables: scouts does not come along
    expect(c.config.guidance).toEqual(["Keep the log append-only."]); // nor its guidance line
    expect(c.stageLessons).toEqual({ build: ["Start the dev server with a timeout before testing. (webby)"] });
    expect(c.basis).toEqual([{ slug: "domain:my-stack", title: "My stack", effect: expect.stringMatching(/^\[my-stack\] 5 implications from webby; on: Think tool; 1 stage line; 1 guidance line; ignored: webby#4/) }]);
    expect(c.label).toBe("Medium · Check in · My Stack");
  });
  it("an unknown domain is still refused, naming the user-built ones among the known", () => {
    expect(() => composeRun({ domains: ["nope"] }, lessons, PRESET_RECIPES, undefined, [mine])).toThrow(/unknown domain "nope" \(domains: web, cli, golang, python, my-stack\)/);
  });
  it("domainPresets lists the user-built domain with its label, its effects and what it was built from", () => {
    const ps = domainPresets(lessons, [mine]);
    const p = ps.find((x) => x.id === "my-stack")!;
    expect(p).toMatchObject({ name: "My stack", description: "What I care about.", layer: "domain", short: "My Stack", generated: true, user: true });
    expect(p.config.components!.thinkTool).toBe(true);
    expect(p.config.guidance).toEqual(["Keep the log append-only."]);
    expect(p.basis).toEqual([{ slug: "webby", title: "Lesson webby", effect: "5 implications" }]);
    expect(ps.map((x) => x.id)).toEqual(["web", "cli", "golang", "python", "my-stack"]);
  });
});

describe("domains.json", () => {
  const home = seededHome("reins-domains-");
  const prev = process.env.REINS_HOME;
  beforeAll(() => {
    process.env.REINS_HOME = home;
  });
  afterAll(() => {
    process.env.REINS_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  });
  it("saves, lists, replaces by id and deletes, validating against the real library", async () => {
    const { deleteDomain, DomainNotFound, DomainValidationError, listDomains, saveDomain } = await import("./domains.js");
    const { listLessons } = await import("./lessons.js");
    const first = listLessons()[0];
    const ids = first.items.filter((i) => i.standing !== "unreviewed" && !i.implicit).slice(0, 2).map((i) => i.id);
    expect(listDomains()).toEqual([]);
    const saved = saveDomain({ label: "Team rules", description: "ours", implications: ids });
    expect(saved).toMatchObject({ id: "team-rules", label: "Team rules", implications: ids });
    expect(typeof saved.createdAt).toBe("string");
    expect(listDomains().map((d) => d.id)).toEqual(["team-rules"]);
    expect(fs.existsSync(path.join(home, "domains.json"))).toBe(true);
    saveDomain({ id: "team-rules", label: "Team rules v2", implications: [ids[0]] });
    expect(listDomains()[0]).toMatchObject({ label: "Team rules v2", implications: [ids[0]] });
    expect(() => saveDomain({ id: "web", label: "x", implications: ids })).toThrow(DomainValidationError);
    expect(() => saveDomain({ label: "x", implications: ["nope#1"] })).toThrow(/nope#1/);
    deleteDomain("team-rules");
    expect(listDomains()).toEqual([]);
    expect(() => deleteDomain("team-rules")).toThrow(DomainNotFound);
  });
  it("a run composed with a saved domain records it and carries its stage lines", async () => {
    const { saveDomain, deleteDomain } = await import("./domains.js");
    const { resolveRunInput } = await import("./presets.js");
    const { listLessons } = await import("./lessons.js");
    const stage = listLessons().flatMap((l) => l.items).find((i) => i.kind === "stage" && i.target === "build" && i.standing !== "unreviewed")!;
    saveDomain({ id: "build-notes", label: "Build notes", implications: [stage.id] });
    const cfg = resolveRunInput({ task: "t", workspace: "/w", domains: ["build-notes"] } as any);
    expect(cfg.domains).toEqual(["build-notes"]);
    // The picked line is in the build block, next to the untagged stage lines every run gets.
    expect(cfg.stageLessons?.build).toContain(`${stage.claim} (${stage.lesson})`);
    expect(cfg.preset).toBe("Medium · Check in · Build Notes");
    deleteDomain("build-notes");
  });
});
