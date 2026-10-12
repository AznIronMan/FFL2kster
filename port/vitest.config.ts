import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // ROM-dependent tests look for FFL2K_ROM (default ../input/original.gb) and skip without it.
    testTimeout: 60_000,
  },
});
