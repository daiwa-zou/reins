import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_TOOLS, scrubbedEnv, truncate } from "./registry.js";
import { listLessons } from "../lessons.js";
import { seededHome } from "../testLibrary.js";

describe("scrubbedEnv", () => {
  it("drops credentials and keeps ordinary variables", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.MY_SERVICE_TOKEN = "t";
    process.env.GITHUB_TOKEN = "g";
    process.env.PATH_EXTRA = "/x";
    const env = scrubbedEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.MY_SERVICE_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH_EXTRA).toBe("/x");
    expect(env.HOME).toBeDefined();
  });
});

describe("truncate", () => {
  it("keeps head and tail and tells the model how to narrow", () => {
    const big = "a".repeat(30_000) + "END";
    const t = truncate(big);
    expect(t.truncated).toBe(true);
    expect(t.text.endsWith("END")).toBe(true);
    expect(t.text).toContain("Narrow the output");
    expect(t.text.length).toBeLessThan(26_000);
  });
});

describe("list_lessons / read_lesson", () => {
  // The example library in a temp home keeps the developer's own lessons out of the assertions.
  beforeAll(() => {
    process.env.REINS_HOME = seededHome("reins-reg-");
  });
  const ctx = { workspace: process.cwd(), role: "builder", allowNetwork: false, sandbox: false, signal: new AbortController().signal, handlers: {} } as any;
  const list = (input: Record<string, string> = {}) => ALL_TOOLS.list_lessons.run(input, ctx);
  const slugs = (out: string) => out.split("\n").map((l) => l.split(":")[0]);

  it("lists every lesson as compact `slug: title — short takeaway` lines of at most 160 characters", async () => {
    const out = await list();
    const lines = out.split("\n");
    expect(lines).toHaveLength(listLessons().length);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(160);
      expect(line).toMatch(/^[a-z0-9._-]+: .+/);
    }
    expect(lines.some((l) => / — /.test(l))).toBe(true);
  });

  it("filters by query", async () => {
    const out = await list({ query: "think tool" });
    expect(slugs(out)).toContain("claude-think-tool");
    expect(slugs(out).length).toBeLessThan(listLessons().length);
  });

  it("filters by tag", async () => {
    const tag = listLessons().find((l) => l.slug === "agent-skills")!.tags[0];
    const out = await list({ tag });
    expect(slugs(out)).toContain("agent-skills");
    for (const s of slugs(out)) expect(listLessons().find((l) => l.slug === s)!.tags).toContain(tag);
  });

  it("filters by component: thinkTool returns claude-think-tool", async () => {
    const out = await list({ component: "thinkTool" });
    expect(slugs(out)).toEqual(["claude-think-tool"]);
  });

  it("says clearly when nothing matches", async () => {
    expect(await list({ query: "zzz-no-such-thing" })).toMatch(/^No lessons match query="zzz-no-such-thing"/);
  });

  it("read_lesson keeps its { slug } schema and its unknown-slug error", async () => {
    const schema = ALL_TOOLS.read_lesson.schema as any;
    expect(Object.keys(schema.input_schema.properties)).toEqual(["slug"]);
    expect(schema.input_schema.required).toEqual(["slug"]);
    await expect(ALL_TOOLS.read_lesson.run({ slug: "nope" }, ctx)).rejects.toThrow("No lesson nope. Call list_lessons.");
    expect(await ALL_TOOLS.read_lesson.run({ slug: "claude-think-tool" }, ctx)).toMatch(/^# /);
  });
});
