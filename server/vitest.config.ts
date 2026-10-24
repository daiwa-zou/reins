import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(root, "shared") } },
  test: { root, include: ["server/src/**/*.test.ts", "web/src/**/*.test.ts"] },
});
