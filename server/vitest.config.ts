import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ test: { root: path.resolve(here, ".."), include: ["server/src/**/*.test.ts"] } });
