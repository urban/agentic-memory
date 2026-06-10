// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readFileSync } from "node:fs";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { ConfigProvider, Effect, FileSystem, Layer, ManagedRuntime, PlatformError } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeScratchpadJson, encodeScratchpadJson } from "../../src/schema.ts";
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
      `{"version":1,"vaultPath":"${vaultA}","projectLink":"[[projects/capture-extension]]","projectRoot":"${cwd}"}\n`,
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

  it("rejects repo-local config files that are not bound to the current checkout", () => {
    const root = createTempDirectory("pi-memory-config-binding-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".pi", "agentic-memory-capture");
    const vault = join(root, "vault");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(localDirectory, "config.json"),
      '{"version":1,"vaultPath":"/ignored","projectLink":"[[projects/capture-extension]]"}\n',
    );

    return ConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* Config;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("invalid");
        if (loaded._tag === "invalid") {
          expect(loaded.message).toContain("bound to this checkout");
        }
      }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: {
              AGENTIC_MEMORY_VAULT: vault,
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

  it("does not fall back to the builtin scaffold when the project template check fails", () => {
    const written: string[] = [];
    const runtime = ManagedRuntime.make(
      Config.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            FileSystem.layerNoop({
              exists: (path) =>
                path.endsWith("/projects/capture-extension.md")
                  ? Effect.succeed(false)
                  : path.endsWith("/.agentic-memory/templates/project.md")
                    ? Effect.fail(
                        PlatformError.systemError({
                          module: "FileSystem",
                          method: "exists",
                          _tag: "PermissionDenied",
                          pathOrDescriptor: path,
                        }),
                      )
                    : Effect.succeed(false),
              makeDirectory: () => Effect.void,
              writeFileString: (_path, content) =>
                Effect.sync(() => {
                  written.push(content);
                }),
            }),
            BunPath.layer,
          ),
        ),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const config = yield* Config;
          const result = yield* config
            .ensureProjectFile("/vault", "[[projects/capture-extension]]", "2026-06-05")
            .pipe(Effect.exit);

          expect(result._tag).toBe("Failure");
          expect(written).toHaveLength(0);
        }),
      )
      .finally(() => runtime.dispose());
  });

  it("does not overwrite git excludes when the existing file cannot be read", () => {
    const written: string[] = [];
    const runtime = ManagedRuntime.make(
      Config.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            FileSystem.layerNoop({
              makeDirectory: () => Effect.void,
              readFileString: (path) =>
                Effect.fail(
                  PlatformError.systemError({
                    module: "FileSystem",
                    method: "readFileString",
                    _tag: "PermissionDenied",
                    pathOrDescriptor: path,
                  }),
                ),
              writeFileString: (_path, content) =>
                Effect.sync(() => {
                  written.push(content);
                }),
            }),
            BunPath.layer,
          ),
        ),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const config = yield* Config;
          const result = yield* config.ensureGitExcludeEntry("/repo/.git").pipe(Effect.exit);

          expect(result._tag).toBe("Failure");
          expect(written).toHaveLength(0);
        }),
      )
      .finally(() => runtime.dispose());
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

  it("reports unreadable scratchpad files as read failures instead of blank files", () => {
    const runtime = ManagedRuntime.make(
      ScratchpadStore.layer.pipe(
        Layer.provide(
          FileSystem.layerNoop({
            exists: () => Effect.succeed(true),
            readFileString: (path) =>
              Effect.fail(
                PlatformError.systemError({
                  module: "FileSystem",
                  method: "readFileString",
                  _tag: "PermissionDenied",
                  pathOrDescriptor: path,
                }),
              ),
          }),
        ),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* ScratchpadStore;
          const loaded = yield* store.load(
            "/repo/.pi/agentic-memory-capture/scratchpad.json",
            "[[projects/capture-extension]]",
            "2026-06-05T12:00:00.000Z",
          );

          expect(loaded.scratchpad.pendingCandidates).toHaveLength(0);
          expect(loaded.warnings[0]).toContain("Failed to read scratchpad file");
        }),
      )
      .finally(() => runtime.dispose());
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
