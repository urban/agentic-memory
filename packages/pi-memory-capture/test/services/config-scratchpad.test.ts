// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readFileSync } from "node:fs";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeScratchpadJson,
  encodeProjectConfigJson,
  encodeScratchpadJson,
} from "../../src/schema.ts";
import { SCRATCHPAD_CANDIDATE_LIMIT, TRUNCATION_SUFFIX } from "../../src/constants.ts";
import { Config } from "../../src/services/Config.ts";
import { ScratchpadStore } from "../../src/services/Scratchpad.ts";
import { createTempDirectory, removeTempDirectory, writeFile } from "../helpers.ts";

const InfrastructureLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const ConfigTestLayer = Config.layer.pipe(Layer.provide(InfrastructureLayer));
const ScratchpadTestLayer = ScratchpadStore.layer.pipe(Layer.provide(InfrastructureLayer));
const ConfigRuntime = ManagedRuntime.make(ConfigTestLayer);
const ScratchpadRuntime = ManagedRuntime.make(ScratchpadTestLayer);

describe("Config", () => {
  it("loads valid config and applies the vault override", () => {
    const root = createTempDirectory("pi-memory-config-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".pi", "agentic-memory-capture");
    const vaultA = join(root, "vault-a");
    const vaultB = join(root, "vault-b");

    writeFile(join(vaultA, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(join(vaultB, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(localDirectory, "config.json"),
      `${Effect.runSync(
        encodeProjectConfigJson({
          version: 1,
          vaultPath: vaultA,
          projectLink: "[[projects/capture-extension]]",
        }),
      )}\n`,
    );

    return ConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* Config;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("valid");
        if (loaded._tag === "valid") {
          expect(loaded.config.vaultPath).toBe(vaultB);
          expect(loaded.config.projectLink).toBe("[[projects/capture-extension]]");
        }
      }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: {
              AGENTIC_MEMORY_VAULT: vaultB,
            },
          }),
        ),
      ),
    ).finally(() => removeTempDirectory(root));
  });

  it("creates project files, updates MEMORY routes, and appends git excludes idempotently", () => {
    const root = createTempDirectory("pi-memory-init-");
    const vault = join(root, "vault");
    const gitDir = join(root, ".git");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(vault, "MEMORY.md"),
      `---
updated: 2026-01-01
---

# Memory

## Current

- Active work.
`,
    );
    writeFile(join(gitDir, "info", "exclude"), "");

    return ConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* Config;
        const created = yield* config.ensureProjectFile(
          vault,
          "[[projects/capture-extension]]",
          "2026-06-05",
        );
        const routeAdded = yield* config.ensureMemoryRoute(
          vault,
          "[[projects/capture-extension]]",
          "2026-06-05",
        );
        const firstExclude = yield* config.ensureGitExcludeEntry(gitDir);
        const secondExclude = yield* config.ensureGitExcludeEntry(gitDir);

        expect(created).toBe(true);
        expect(routeAdded).toBe(true);
        expect(firstExclude).toBe(true);
        expect(secondExclude).toBe(false);
      }),
    ).finally(() => removeTempDirectory(root));
  });
});

describe("ScratchpadStore", () => {
  it("falls back to an empty scratchpad when the file is invalid or for the wrong project", () => {
    const root = createTempDirectory("pi-memory-scratchpad-");
    const invalidPath = join(root, "invalid.json");
    const mismatchPath = join(root, "mismatch.json");

    writeFile(invalidPath, "{not valid json");
    writeFile(
      mismatchPath,
      Effect.runSync(
        encodeScratchpadJson({
          version: 1,
          projectLink: "[[projects/other-project]]",
          updatedAt: "2026-06-05T12:00:00.000Z",
          pendingCandidates: [],
        }),
      ),
    );

    return ScratchpadRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* ScratchpadStore;
        const invalid = yield* store.load(
          invalidPath,
          "[[projects/capture-extension]]",
          "2026-06-05T12:00:00.000Z",
        );
        const mismatch = yield* store.load(
          mismatchPath,
          "[[projects/capture-extension]]",
          "2026-06-05T12:00:00.000Z",
        );

        expect(invalid.scratchpad.pendingCandidates).toHaveLength(0);
        expect(invalid.warnings[0]).toContain("Ignoring invalid scratchpad");
        expect(mismatch.scratchpad.projectLink).toBe("[[projects/capture-extension]]");
        expect(mismatch.warnings[0]).toContain("did not match the current config");
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("bounds candidates and truncates long fields on write", () => {
    const root = createTempDirectory("pi-memory-scratchpad-write-");
    const filepath = join(root, "scratchpad.json");

    return ScratchpadRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* ScratchpadStore;
        const written = yield* store.write(
          filepath,
          {
            version: 1,
            projectLink: "[[projects/capture-extension]]",
            updatedAt: "2026-06-05T12:00:00.000Z",
            pendingCandidates: Array.from(
              { length: SCRATCHPAD_CANDIDATE_LIMIT + 5 },
              (_, index) => ({
                id: `candidate-${index}`,
                kind: "resume_context",
                summary: `summary-${index}-${"x".repeat(700)}`,
                evidenceCount: index + 1,
                firstSeenAt: "2026-06-05T12:00:00.000Z",
                lastSeenAt: "2026-06-05T12:00:00.000Z",
                confidence: "medium",
                nextAction: "wait",
                reasonNotPromoted: `reason-${"y".repeat(500)}`,
              }),
            ),
          },
          "2026-06-05T13:00:00.000Z",
        );
        const decoded = yield* decodeScratchpadJson(readFileSync(filepath, "utf8"));

        expect(written.pendingCandidates).toHaveLength(SCRATCHPAD_CANDIDATE_LIMIT);
        expect(decoded.pendingCandidates).toHaveLength(SCRATCHPAD_CANDIDATE_LIMIT);
        expect(decoded.pendingCandidates[0]?.summary.endsWith(TRUNCATION_SUFFIX)).toBe(true);
        expect(decoded.pendingCandidates[0]?.reasonNotPromoted.endsWith(TRUNCATION_SUFFIX)).toBe(
          true,
        );
      }),
    ).finally(() => removeTempDirectory(root));
  });
});
