// npm run lessons:examples — copy the example lessons (examples/lessons/*.md, the
// 30 distilled Anthropic engineering posts) into your library, $REINS_HOME/lessons.
// Existing files with the same name are kept unless --force is given.
// They arrive as user lessons with standing "reviewed" set in the copy, so their
// implications take effect in stage blocks and domains at once.
import fs from "node:fs";
import path from "node:path";
import { EXAMPLES_DIR, userLessonsDir } from "../src/lessons.js";

const force = process.argv.includes("--force");
const dest = userLessonsDir();
fs.mkdirSync(dest, { recursive: true });
const files = fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".md")).sort();
let copied = 0;
let kept = 0;
for (const f of files) {
  const to = path.join(dest, f);
  if (fs.existsSync(to) && !force) {
    kept++;
    continue;
  }
  const raw = fs.readFileSync(path.join(EXAMPLES_DIR, f), "utf8");
  // The examples say `standing: bundled`; in a user library that reads as reviewed.
  fs.writeFileSync(to, raw.replace(/^standing:\s*bundled\s*$/m, "standing: reviewed"));
  copied++;
}
console.log(`${copied} example lesson${copied === 1 ? "" : "s"} copied to ${dest}${kept ? `; ${kept} already there (use --force to overwrite)` : ""}.`);
