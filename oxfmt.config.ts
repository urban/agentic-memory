import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    ".agents/**",
    ".codex/**",
    ".dotai/**",
    ".motel-data/**",
    ".ralph-tm/**",
    ".repos/**",
    ".specs/**",
    ".tasks/**",
    ".tmp/**",
    "coverage/**",
    "node_modules/**",
    "packages/*/node_modules/**",
  ],
});
