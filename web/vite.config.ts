import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": path.resolve(here, "../shared") },
  },
  server: {
    port: 5190,
    proxy: {
      "/api": { target: "http://localhost:5191", changeOrigin: true },
      "/ws": { target: "ws://localhost:5191", ws: true },
    },
  },
  build: { outDir: path.resolve(here, "../dist/web"), emptyOutDir: true },
});
