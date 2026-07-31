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

interface FileSystemAccess {
  calls: number;
}

const makeObservedFileSystem = (access: FileSystemAccess): FileSystem.FileSystem =>
  new Proxy(FileSystem.makeNoop({}), {
    get: (target, property, receiver): unknown => {
      const member: unknown = Reflect.get(target, property, receiver);
      return typeof member === "function"
        ? (...args: ReadonlyArray<unknown>) => {
            access.calls += 1;
            return Reflect.apply(member, target, args);
          }
        : member;
    },
  });

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

  const singularQuestions = [
    "What latency budget applies to Alpha retry scheduling?",
    "Who owns the Alpha release?",
    "When was the retry policy approved?",
    "What does the phrase as well as mean?",
    "What does the phrase plus who mean?",
    "What does the phrase also tell me mean?",
    "When did the phrase also tell me become common?",
    'When did the phrase "also tell me" become common?',
    "What did Alice also tell me about Alpha?",
    "When did Alice also tell me the budget?",
    "Explain what the plus operator means.",
    "Tell me what the phrase as well as means.",
    'What does the phrase "show and tell" mean?',
    'What does the expression "and explain" mean?',
    'What does the word "show and tell" mean?',
    'What does the term "and explain" mean?',
  ];

  for (const question of singularQuestions) {
    it.effect(`accepts the singular factual question: ${question}`, () => {
      const access: EmbeddingModelAccess = {
        embedCalls: 0,
        inspectCalls: 0,
        installCalls: 0,
        rejectEmbeddings: false,
      };
      return withRecallRuntime(
        access,
        recall({
          vaultPath: "/vault/that/does/not/exist",
          question,
        }).pipe(
          Effect.result,
          Effect.map((result) => {
            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "ReadVaultFailed");
            }
            assert.strictEqual(access.embedCalls, 0);
          }),
        ),
      );
    });
  }

  const unsupportedQuestions = [
    "What latency budget applies? Why was it chosen?",
    "Tell me the latency budget. Explain why it was chosen.",
    "Tell me the latency budget.\nExplain why it was chosen.",
    "Tell me the latency budget; explain why it was chosen.",
    "What latency budget applies, and why was it chosen?",
    "What latency budget applies, and how should I present it?",
    "What latency budget applies, and what project uses it?",
    "What latency budget applies? Also tell me who approved it.",
    "Tell me the latency budget as well as who approved it.",
    "Tell me the latency budget as well as its rationale.",
    "Tell me the latency budget and then explain its history.",
    "Tell me the latency budget and then its rationale.",
    "Tell me the latency budget. Plus, explain why it was chosen.",
    "Tell me the latency budget, plus its rationale.",
    "What latency budget applies, plus who approved it?",
    "Tell me the latency budget. Provide the rationale.",
    "Tell me the latency budget\nProvide the rationale.",
    "Tell me the latency budget; include the rationale.",
    "Tell me the latency budget and also tell me who approved it.",
    "Tell me the latency budget also tell me who approved it.",
    'What does the phrase "foo" mean, and what does "bar" mean?',
    "What latency budget applies.Why was it chosen?",
    "What latency budget applies, why was it chosen?",
    "Tell me the latency budget and explain why it was chosen.",
    "Tell me the latency budget and also explain why it was chosen.",
    "Tell me the latency budget. Also, explain why it was chosen.",
    "Tell me the latency budget, and can you explain why it was chosen?",
  ];

  for (const question of unsupportedQuestions) {
    it.effect(`rejects the multipart question before operational access: ${question}`, () => {
      const access: EmbeddingModelAccess = {
        embedCalls: 0,
        inspectCalls: 0,
        installCalls: 0,
        rejectEmbeddings: false,
      };
      const fileSystemAccess: FileSystemAccess = { calls: 0 };
      return withRecallRuntime(
        access,
        recall({
          vaultPath: "/vault/that/should/not/be-inspected",
          question,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, makeObservedFileSystem(fileSystemAccess)),
          Effect.result,
          Effect.map((result) => {
            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "UnsupportedMultipartQuestion");
              assert.include(result.failure.message, "separate recall commands");
            }
            assert.strictEqual(fileSystemAccess.calls, 0);
            assert.strictEqual(access.inspectCalls, 0);
            assert.strictEqual(access.embedCalls, 0);
            assert.strictEqual(access.installCalls, 0);
          }),
        ),
      );
    });
  }

  it.effect(
    "validates a large repeated-marker question within a bounded time",
    () => {
      const access: EmbeddingModelAccess = {
        embedCalls: 0,
        inspectCalls: 0,
        installCalls: 0,
        rejectEmbeddings: false,
      };
      return withRecallRuntime(
        access,
        recall({
          vaultPath: "/vault/that/does/not/exist",
          question: `${"plus x ".repeat(64_000)}end`,
        }).pipe(
          Effect.result,
          Effect.map((result) => {
            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "ReadVaultFailed");
            }
            assert.strictEqual(access.embedCalls, 0);
          }),
        ),
      );
    },
    2_000,
  );

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
            assert.strictEqual(result.failure.reason, "SemanticIndexMissing");
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
            assert.strictEqual(result.failure.reason, "SemanticIndexStale");
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
            assert.strictEqual(result.failure.reason, "SemanticIndexIncomplete");
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
