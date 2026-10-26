// npm run docs:tables: rewrite the generated tables in docs/configuring.md from shared/components.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyGeneratedBlocks, GENERATED_BLOCKS, generatedBlock } from "../../shared/docsTables.js";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/configuring.md");
const before = fs.readFileSync(file, "utf8");
for (const name of Object.keys(GENERATED_BLOCKS)) if (generatedBlock(before, name) === null) {
  console.error(`docs/configuring.md has no <!-- generated:${name} --> block`);
  process.exit(1);
}
const after = applyGeneratedBlocks(before);
if (after !== before) fs.writeFileSync(file, after);
console.log(after === before ? "docs/configuring.md: tables up to date." : "docs/configuring.md: tables rewritten.");
