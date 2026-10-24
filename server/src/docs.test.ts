import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENT_IDS } from "../../shared/components.js";
import { parseLesson } from "../../shared/lessons.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("docs cannot drift", () => {
  it("docs/configuring.md mentions every component id", () => {
    const doc = read("docs/configuring.md");
    const missing = COMPONENT_IDS.filter((id) => !doc.includes(`\`${id}\``));
    expect(missing).toEqual([]);
  });

  it("covers presets.json, lessons:check and the user lessons dir", () => {
    const doc = read("docs/configuring.md");
    for (const s of ["presets.json", "npm run lessons:check", "$REINS_HOME/lessons", "$REINS_HOME/skills"]) expect(doc).toContain(s);
  });

  it("docs/lesson-template.md lives outside lessons/ and parses with no problems", () => {
    expect(fs.existsSync(path.join(root, "lessons", "lesson-template.md"))).toBe(false);
    const { lesson, problems } = parseLesson("lesson-template", read("docs/lesson-template.md"), "user");
    expect(problems).toEqual([]);
    expect(lesson!.components).toContain("thinkTool");
  });

  it("the README links both docs", () => {
    const readme = read("README.md");
    expect(readme).toContain("docs/configuring.md");
    expect(readme).toContain("docs/lesson-template.md");
  });
});
