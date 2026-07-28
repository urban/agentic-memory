import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { bundledVaultTemplatePath } from "@urban/agentic-memory-vault-template/VaultTemplatePackage";
import { Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect";
import { recall } from "../src/recall/Recall.ts";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EmbeddingModel,
  EmbeddingRuntimeError,
  makeEmbeddingModel,
} from "../src/semantic/EmbeddingModel.ts";
import { synchronizeSemanticIndex } from "../src/semantic/SemanticIndex.ts";

interface EmbeddingModelAccess {
  embedCalls: number;
  inspectCalls: number;
  installCalls: number;
  rejectEmbeddings: boolean;
}

const makeObservedEmbeddingModelLayer = (
  access: EmbeddingModelAccess,
): Layer.Layer<EmbeddingModel> =>
  Layer.succeed(
    EmbeddingModel,
    makeEmbeddingModel({
      inspect: Effect.sync(() => {
        access.inspectCalls += 1;
        return { status: "available", id: EMBEDDING_MODEL_ID };
      }),
      install: Effect.sync(() => {
        access.installCalls += 1;
        return { status: "already_available", id: EMBEDDING_MODEL_ID };
      }),
      embed: (texts) => {
        access.embedCalls += 1;
        return access.rejectEmbeddings
          ? Effect.fail(new EmbeddingRuntimeError({ message: "Rejected embedding for test" }))
          : Effect.succeed(
              texts.map(() => Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, () => 0)),
            );
      },
    }),
  );

const withRecallRuntime = <A, E, R>(
  access: EmbeddingModelAccess,
  effect: Effect.Effect<A, E, R | EmbeddingModel | BunServices.BunServices>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.merge(BunServices.layer, makeObservedEmbeddingModelLayer(access)),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const writeLexicallyAnswerableVault = Effect.fnUntraced(function* (vaultPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const templatePath = yield* bundledVaultTemplatePath();
  yield* fs.copy(templatePath, vaultPath, { overwrite: false });
  yield* fs.writeFileString(
    path.join(vaultPath, "notes", "alpha-latency.md"),
    "# Alpha latency\n\nAlpha retry scheduling uses a 200ms p95 latency budget.\n",
  );
});

describe("recall semantic index readiness", () => {
  it.effect("rejects a blank question before inspecting the index or embedding model", () => {
    const access: EmbeddingModelAccess = {
      embedCalls: 0,
      inspectCalls: 0,
      installCalls: 0,
      rejectEmbeddings: false,
    };
    return withRecallRuntime(
      access,
      recall({
        vaultPath: "/vault/that/should/not/be-inspected",
        question: " \n\t ",
      }).pipe(
        Effect.result,
        Effect.map((result) => {
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "InvalidQuestion");
          }
          assert.strictEqual(access.inspectCalls, 0);
          assert.strictEqual(access.embedCalls, 0);
          assert.strictEqual(access.installCalls, 0);
        }),
      ),
    );
  });

  it.effect("rejects a lexically answerable vault when its semantic index is missing", () => {
    const access: EmbeddingModelAccess = {
      embedCalls: 0,
      inspectCalls: 0,
      installCalls: 0,
      rejectEmbeddings: false,
    };
    return withRecallRuntime(
      access,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-recall-missing-index-",
          });
          yield* writeLexicallyAnswerableVault(vaultPath);

          const result = yield* recall({
            vaultPath,
            question: "What latency budget applies to Alpha retry scheduling?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "SemanticIndexNotReady");
            assert.include(result.failure.message, "Semantic index is missing");
          }
          assert.strictEqual(access.embedCalls, 0);
          assert.strictEqual(access.installCalls, 0);
          assert.isFalse(yield* fs.exists(path.join(vaultPath, ".agentic-memory", "index")));
        }),
      ),
    );
  });

  it.effect("rejects a stale semantic index without embedding or synchronizing it", () => {
    const access: EmbeddingModelAccess = {
      embedCalls: 0,
      inspectCalls: 0,
      installCalls: 0,
      rejectEmbeddings: false,
    };
    return withRecallRuntime(
      access,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-recall-stale-index-",
          });
          yield* writeLexicallyAnswerableVault(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          access.embedCalls = 0;
          access.installCalls = 0;

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "alpha-latency.md"),
            "# Alpha latency\n\nAlpha retry scheduling now uses a 250ms p95 latency budget.\n",
          );
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const databaseBeforeRecall = yield* fs.readFile(databasePath);

          const result = yield* recall({
            vaultPath,
            question: "What latency budget applies to Alpha retry scheduling?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "SemanticIndexNotReady");
            assert.include(result.failure.message, "Semantic index is stale");
          }
          assert.strictEqual(access.embedCalls, 0);
          assert.strictEqual(access.installCalls, 0);
          assert.deepStrictEqual(yield* fs.readFile(databasePath), databaseBeforeRecall);
        }),
      ),
    );
  });

  it.effect("rejects an incomplete semantic index without embedding or repairing it", () => {
    const access: EmbeddingModelAccess = {
      embedCalls: 0,
      inspectCalls: 0,
      installCalls: 0,
      rejectEmbeddings: false,
    };
    return withRecallRuntime(
      access,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-recall-incomplete-index-",
          });
          yield* writeLexicallyAnswerableVault(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "alpha-latency.md"),
            "# Alpha latency\n\nAlpha retry scheduling now uses a 250ms p95 latency budget.\n",
          );
          access.rejectEmbeddings = true;
          const interruptedSynchronization = yield* synchronizeSemanticIndex(vaultPath).pipe(
            Effect.result,
          );
          assert.strictEqual(interruptedSynchronization._tag, "Failure");
          access.rejectEmbeddings = false;
          access.embedCalls = 0;
          access.installCalls = 0;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const databaseBeforeRecall = yield* fs.readFile(databasePath);

          const result = yield* recall({
            vaultPath,
            question: "What latency budget applies to Alpha retry scheduling?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "SemanticIndexNotReady");
            assert.include(result.failure.message, "Semantic index is incomplete");
          }
          assert.strictEqual(access.embedCalls, 0);
          assert.strictEqual(access.installCalls, 0);
          assert.deepStrictEqual(yield* fs.readFile(databasePath), databaseBeforeRecall);
        }),
      ),
    );
  });
});
