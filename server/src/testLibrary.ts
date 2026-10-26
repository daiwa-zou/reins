// Test kit: a temporary REINS_HOME whose lessons/ holds the example library,
// for tests that need real lessons now that lessons/ ships empty.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXAMPLES_DIR } from "./lessons.js";

/** Create a temp home seeded with examples/lessons (as reviewed user lessons) and return it. Does not set REINS_HOME. */
export function seededHome(prefix = "reins-lib-"): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(home, "lessons");
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(EXAMPLES_DIR).filter((x) => x.endsWith(".md"))) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(EXAMPLES_DIR, f), "utf8").replace(/^standing:\s*bundled\s*$/m, "standing: reviewed"));
  return home;
}
