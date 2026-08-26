import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [],
  test: {
    globals: true,
    environment: "node",
    coverage: { provider: "v8", reporter: ["text", "json", "html"], reportsDirectory: "coverage" },
    include: ["packages/*/test/**/*.test.ts"],
  },
});
