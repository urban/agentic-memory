import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import { synchronizeSemanticIndex } from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { initVaultFromTemplate } from "@urban/agentic-memory-core/vault/VaultTemplate";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const recallFixtureVaultPath = fileURLToPath(
  new URL("../../../core/test/fixtures/retrieval/basic-vault/", import.meta.url),
);
const recallQuestion =
  "In Alpha Product, what latency budget should I follow, and how should I present options back to Urban?";
const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

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
