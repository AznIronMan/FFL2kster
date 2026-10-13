import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

/** The project version (pyproject.toml is the single source), shown in About and bug reports. */
const version = /^version = "([^"]+)"/m.exec(readFileSync(new URL("../../../pyproject.toml", import.meta.url), "utf8"))?.[1] ?? "dev";

export default defineConfig({
  base: "./",
  build: { target: "es2022", outDir: "dist", sourcemap: true },
  worker: { format: "es" },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
