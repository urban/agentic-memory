import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { afterAll } from "vitest";
import { decodeInitVaultResultJson } from "../../src/commands/init-output.ts";
import { decodeCliFailureResultJson } from "../../src/output.ts";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory init command", () => {
  afterAll(dispose);

  it.effect("initializes vaults from the canonical template package", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({ prefix: "agentic-memory-init-" });
          const vaultPath = path.join(tempRoot, "vault");
          const output = yield* runCapturedEffect(["init", vaultPath, "--json"]);
          const memoryExists = yield* fs.exists(path.join(vaultPath, "MEMORY.md"));
          const localContractExists = yield* fs.exists(
            path.join(vaultPath, ".agentic-memory", "LLM-vault-local.md"),
          );
          const adapterExists = yield* fs.exists(
            path.join(vaultPath, ".agentic-memory", "adapters", "MEMORY_ADAPTER.md"),
          );
          const sessionCaptureExists = yield* fs.exists(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
          );

          return {
            adapterExists,
            localContractExists,
            memoryExists,
            output,
            sessionCaptureExists,
          };
        }),
      ),
    ).pipe(
      Effect.flatMap(
        ({ adapterExists, localContractExists, memoryExists, output, sessionCaptureExists }) =>
          Effect.gen(function* () {
            assert.strictEqual(output.exitCode, 0);
            const result = yield* decodeInitVaultResultJson(output.stdout);
            assert.strictEqual(result.status, "initialized");
            assert.strictEqual(result.model.status, "available");
            assert.strictEqual(result.model.installation, "already_available");
            assert.isFalse(result.changes.updatedGitIgnore);
            assert.strictEqual(output.stderr, "");
            assert.isTrue(memoryExists);
            assert.isTrue(localContractExists);
            assert.isTrue(adapterExists);
            assert.isTrue(sessionCaptureExists);
          }),
      ),
    ),
  );

  it.effect("reports model and semantic-index ignore state in human init output", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-init-human-",
          });
          return yield* runCapturedEffect(["init", path.join(tempRoot, "vault")]);
        }),
      ),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 0);
        assert.include(
          output.stdout,
          "Embedding model embeddinggemma-300M-Q8_0 was already available",
        );
        assert.include(output.stdout, ".agentic-memory/index/");
        assert.strictEqual(output.stderr, "");
      }),
    ),
  );

  it.effect("resolves a relative vault target from the shared -C directory", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-init-directory-",
          });
          const effectiveDirectory = yield* fs.realPath(tempRoot);
          const output = yield* runCapturedEffect(["-C", tempRoot, "init", "vault", "--json"]);
          const result = yield* decodeInitVaultResultJson(output.stdout);
          return { output, result, vaultPath: path.join(effectiveDirectory, "vault") };
        }),
      ),
    ).pipe(
      Effect.map(({ output, result, vaultPath }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(result.vaultPath, vaultPath);
      }),
    ),
  );

  it.effect("defaults relative vault targets to the real invocation directory", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            directory: process.cwd(),
            prefix: "agentic-memory-init-default-directory-",
          });
          const effectiveDirectory = yield* fs.realPath(process.cwd());
          const relativeTarget = path.relative(process.cwd(), path.join(tempRoot, "vault"));
          const output = yield* runCapturedEffect(["init", relativeTarget, "--json"]);
          const result = yield* decodeInitVaultResultJson(output.stdout);
          return {
            output,
            result,
            vaultPath: path.resolve(effectiveDirectory, relativeTarget),
          };
        }),
      ),
    ).pipe(
      Effect.map(({ output, result, vaultPath }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(result.vaultPath, vaultPath);
      }),
    ),
  );

  it.effect("rejects invalid effective directories and path inputs", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-init-invalid-path-",
          });
          const filePath = yield* fs.makeTempFileScoped({
            directory: tempRoot,
            prefix: "not-a-directory-",
          });
          const directoryOutput = yield* runCapturedEffect(["-C", filePath, "init", "vault"]);
          const pathOutput = yield* runCapturedEffect(["-C", tempRoot, "init", "", "--json"]);
          const failure = yield* decodeCliFailureResultJson(pathOutput.stdout);
          return { directoryOutput, failure, pathOutput };
        }),
      ),
    ).pipe(
      Effect.map(({ directoryOutput, failure, pathOutput }) => {
        assert.strictEqual(directoryOutput.exitCode, 1);
        assert.include(directoryOutput.stderr, "Expected: existing directory");
        assert.strictEqual(pathOutput.exitCode, 2);
        assert.strictEqual(failure.error.code, "InvalidPathInput");
        assert.include(failure.error.message, "non-empty path");
      }),
    ),
  );
});
