import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import {
  EmbeddingModel,
  EmbeddingRuntimeError,
  makeFakeEmbeddingModel,
} from "@urban/agentic-memory-core/semantic/EmbeddingModel";
import { synchronizeSemanticIndex } from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { initVaultFromTemplate } from "@urban/agentic-memory-core/vault/VaultTemplate";
import { assert, describe, it } from "@effect/vitest";
import { createClient } from "@libsql/client";
import { Effect, FileSystem, Path } from "effect";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { decodeCliFailureResultJson } from "../../src/output.ts";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const recallFixtureVaultPath = fileURLToPath(
  new URL("../../../core/test/fixtures/retrieval/basic-vault/", import.meta.url),
);
const recallQuestion =
  "In Alpha Product, what latency budget should I follow, and how should I present options back to Urban?";
const { dispose, runCapturedEffect, runCapturedEffectWithEmbeddingModel, withCliRuntime } =
  makeCliTestRuntime();

const withIndexedRecallFixture = <A, E, R>(use: (vaultPath: string) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const vaultPath = yield* fs.makeTempDirectoryScoped({
        prefix: "agentic-memory-cli-recall-indexed-",
      });
      yield* initVaultFromTemplate({
        targetPath: vaultPath,
        initializeGit: false,
        yes: true,
      });
      yield* fs.copy(recallFixtureVaultPath, vaultPath, { overwrite: true });
      yield* synchronizeSemanticIndex(vaultPath);
      return yield* use(vaultPath);
    }),
  );

describe("agentic-memory recall command", () => {
  afterAll(dispose);

  it.effect("can import the public recall contract from core exports", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeRecallSuccessJson(
        '{"status":"answered","question":"What should I follow?","answer":"Follow the contract.","warnings":[]}',
      );

      assert.strictEqual(decoded.status, "answered");
      assert.strictEqual(decoded.answer, "Follow the contract.");
    }),
  );
  it.effect("emits public recall success JSON for answered recall", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        runCapturedEffect(["recall", recallQuestion, "--vault", vaultPath, "--json"]).pipe(
          Effect.flatMap((output) =>
            decodeRecallSuccessJson(output.stdout.trim()).pipe(
              Effect.map((decoded) => ({
                decoded,
                output,
              })),
            ),
          ),
        ),
      ),
    ).pipe(
      Effect.map(({ decoded, output }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(decoded.status, "answered");
        assert.strictEqual(decoded.question, recallQuestion);
        assert.strictEqual(
          decoded.answer,
          "Alpha Product is the active fixture project for testing project-aware memory retrieval.",
        );
        assert.deepStrictEqual(decoded.warnings, []);
      }),
    ),
  );

  it.effect("maps a missing semantic index to indexing guidance", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-cli-recall-missing-index-",
          });
          yield* initVaultFromTemplate({
            targetPath: vaultPath,
            initializeGit: false,
            yes: true,
          });

          const output = yield* runCapturedEffect([
            "recall",
            recallQuestion,
            "--vault",
            vaultPath,
            "--json",
          ]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "SemanticIndexMissing");
          assert.include(failure.error.message, `agentic-memory index --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, ".agentic-memory");
          assert.notInclude(failure.error.message, "recall.db");
          assert.notInclude(failure.error.message, "embeddinggemma");
        }),
      ),
    ),
  );

  it.effect("maps a stale semantic index to indexing guidance", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            "# Memory\n\nChanged after indexing.\n",
          );

          const output = yield* runCapturedEffect([
            "recall",
            recallQuestion,
            "--vault",
            vaultPath,
            "--json",
          ]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "SemanticIndexStale");
          assert.include(failure.error.message, `agentic-memory index --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, ".agentic-memory");
          assert.notInclude(failure.error.message, "recall.db");
          assert.notInclude(failure.error.message, "768");
        }),
      ),
    ),
  );

  it.effect("maps an incomplete semantic index to indexing guidance", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            "# Memory\n\nChanged before interrupted indexing.\n",
          );
          const fakeModel = makeFakeEmbeddingModel();
          const failedSynchronization = yield* synchronizeSemanticIndex(vaultPath).pipe(
            Effect.provideService(
              EmbeddingModel,
              EmbeddingModel.of({
                ...fakeModel,
                embed: () =>
                  Effect.fail(
                    new EmbeddingRuntimeError({ message: "Rejected embedding for test" }),
                  ),
              }),
            ),
            Effect.result,
          );
          assert.strictEqual(failedSynchronization._tag, "Failure");

          const output = yield* runCapturedEffect([
            "recall",
            recallQuestion,
            "--vault",
            vaultPath,
            "--json",
          ]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "SemanticIndexIncomplete");
          assert.include(failure.error.message, `agentic-memory index --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, ".agentic-memory");
          assert.notInclude(failure.error.message, "recall.db");
          assert.notInclude(failure.error.message, "Rejected embedding");
        }),
      ),
    ),
  );

  it.effect("maps an invalid semantic index to delete-and-rebuild guidance", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-cli-recall-invalid-index-",
          });
          yield* initVaultFromTemplate({
            targetPath: vaultPath,
            initializeGit: false,
            yes: true,
          });
          const indexDirectory = path.join(vaultPath, ".agentic-memory", "index");
          yield* fs.makeDirectory(indexDirectory, { recursive: true });
          const databasePath = path.join(indexDirectory, "recall.db");
          const databaseUrl = yield* path.toFileUrl(databasePath);
          yield* Effect.acquireUseRelease(
            Effect.sync(() => createClient({ url: databaseUrl.href })),
            (client) =>
              Effect.promise(() =>
                client.execute("CREATE TABLE private_database_details (id TEXT)"),
              ),
            (client) => Effect.sync(() => client.close()),
          );

          const output = yield* runCapturedEffect([
            "recall",
            recallQuestion,
            "--vault",
            vaultPath,
            "--json",
          ]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "SemanticIndexInvalid");
          assert.include(
            failure.error.message,
            `agentic-memory index --vault ${vaultPath} --delete`,
          );
          assert.include(failure.error.message, `agentic-memory index --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, ".agentic-memory");
          assert.notInclude(failure.error.message, "recall.db");
          assert.notInclude(failure.error.message, "private-database-details");
        }),
      ),
    ),
  );

  it.effect("maps an incompatible semantic index to delete-and-rebuild guidance", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const databaseUrl = yield* path.toFileUrl(databasePath);
          yield* Effect.acquireUseRelease(
            Effect.sync(() => createClient({ url: databaseUrl.href })),
            (client) =>
              Effect.promise(() =>
                client.execute(
                  "UPDATE index_metadata SET compatibility_fingerprint = 'private-old-fingerprint' WHERE id = 1",
                ),
              ),
            (client) => Effect.sync(() => client.close()),
          );

          const output = yield* runCapturedEffect([
            "recall",
            recallQuestion,
            "--vault",
            vaultPath,
            "--json",
          ]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "SemanticIndexIncompatible");
          assert.include(
            failure.error.message,
            `agentic-memory index --vault ${vaultPath} --delete`,
          );
          assert.include(failure.error.message, `agentic-memory index --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, ".agentic-memory");
          assert.notInclude(failure.error.message, "recall.db");
          assert.notInclude(failure.error.message, "private-old-fingerprint");
        }),
      ),
    ),
  );

  it.effect("maps query preparation failure without exposing embedding internals", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) => {
        const fakeModel = makeFakeEmbeddingModel();
        const rejectingModel = EmbeddingModel.of({
          ...fakeModel,
          embed: () =>
            Effect.fail(
              new EmbeddingRuntimeError({
                message: "Private vector dimension 768 failed in provider /tmp/model.gguf",
              }),
            ),
        });
        return Effect.gen(function* () {
          const output = yield* runCapturedEffectWithEmbeddingModel(
            ["recall", recallQuestion, "--vault", vaultPath, "--json"],
            rejectingModel,
          );
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "QueryEmbeddingFailed");
          assert.include(failure.error.message, `agentic-memory status --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, "768");
          assert.notInclude(failure.error.message, "provider");
          assert.notInclude(failure.error.message, "/tmp/model.gguf");
        });
      }),
    ),
  );

  it.effect("maps semantic search failure without exposing database internals", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const fakeModel = makeFakeEmbeddingModel();
          const removingModel = EmbeddingModel.of({
            ...fakeModel,
            embed: (texts) =>
              fakeModel.embed(texts).pipe(
                Effect.tap(() =>
                  fs.remove(databasePath).pipe(
                    Effect.mapError(
                      (cause) =>
                        new EmbeddingRuntimeError({
                          message: "Failed to prepare the search failure fixture",
                          cause,
                        }),
                    ),
                  ),
                ),
              ),
          });

          const output = yield* runCapturedEffectWithEmbeddingModel(
            ["recall", recallQuestion, "--vault", vaultPath, "--json"],
            removingModel,
          );
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "SemanticSearchFailed");
          assert.include(failure.error.message, `agentic-memory status --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, ".agentic-memory");
          assert.notInclude(failure.error.message, "recall.db");
          assert.notInclude(failure.error.message, "libSQL");
        }),
      ),
    ),
  );

  it.effect("resolves a relative recall vault from the shared -C directory", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const output = yield* runCapturedEffect([
            "-C",
            path.dirname(vaultPath),
            "recall",
            recallQuestion,
            "--vault",
            path.basename(vaultPath),
            "--json",
          ]);
          const result = yield* decodeRecallSuccessJson(output.stdout);
          return { output, result };
        }),
      ),
    ).pipe(
      Effect.map(({ output, result }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(result.status, "answered");
        assert.strictEqual(
          result.answer,
          "Alpha Product is the active fixture project for testing project-aware memory retrieval.",
        );
      }),
    ),
  );

  it.effect("rejects the removed source-inclusion flag", () =>
    withCliRuntime(
      runCapturedEffect([
        "recall",
        recallQuestion,
        "--vault",
        recallFixtureVaultPath,
        "--include-sources",
        "--json",
      ]),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, "agentic-memory recall [flags] <question>");
        assert.include(output.stderr, "Unrecognized flag: --include-sources");
      }),
    ),
  );

  it.effect("reports a missing recall question with existing positional-argument wording", () =>
    withCliRuntime(runCapturedEffect(["recall", "--vault", recallFixtureVaultPath, "--json"])).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, "agentic-memory recall [flags] <question>");
        assert.include(output.stderr, "Missing required argument: question");
      }),
    ),
  );

  it.effect("reports a missing recall vault flag with existing required-flag wording", () =>
    withCliRuntime(runCapturedEffect(["recall", recallQuestion, "--json"])).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, "agentic-memory recall [flags] <question>");
        assert.include(output.stderr, "Missing required flag");
        assert.include(output.stderr, "--vault");
      }),
    ),
  );
});
