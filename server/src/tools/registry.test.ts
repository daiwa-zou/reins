import { describe, expect, it } from "vitest";
import { scrubbedEnv, truncate } from "./registry.js";

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
