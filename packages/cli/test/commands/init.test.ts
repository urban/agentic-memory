import { decodeInitCommandResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { afterAll } from "vitest";
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
            const result = yield* decodeInitCommandResultJson(output.stdout);
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
});
