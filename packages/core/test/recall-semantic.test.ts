import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { bundledVaultTemplatePath } from "@urban/agentic-memory-vault-template/VaultTemplatePackage";
import { Deferred, Effect, Fiber, FileSystem, Layer, ManagedRuntime, Path } from "effect";
import { recall } from "../src/recall/Recall.ts";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EmbeddingModel,
  EmbeddingRuntimeError,
  makeEmbeddingModel,
} from "../src/semantic/EmbeddingModel.ts";
import { synchronizeSemanticIndex } from "../src/semantic/SemanticIndex.ts";

interface EmbeddingControl {
  inputs: Array<string>;
  beforeEmbeddingResult?: Effect.Effect<void>;
  rejectEmbeddings?: boolean;
}

const vector = (first: number, second: number, third: number): ReadonlyArray<number> =>
  Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
    index === 0 ? first : index === 1 ? second : index === 2 ? third : 0,
  );

const embeddingFor = (input: string): ReadonlyArray<number> => {
  if (input.startsWith("task: search result | query:")) return vector(1, 0, 0);
  if (input.includes("approved timeout is 640ms")) return vector(0.99, 0.1, 0);
  if (input.includes("recall timeout answer is 900ms")) return vector(0.2, 0.98, 0);
  if (input.includes("source-near-")) return vector(1, 0.01, 0);
  if (input.includes("eligible semantic fallback")) return vector(0.8, 0.6, 0);
  return vector(0, 0, 1);
};

const makeControlledEmbeddingLayer = (control: EmbeddingControl): Layer.Layer<EmbeddingModel> =>
  Layer.succeed(
    EmbeddingModel,
    makeEmbeddingModel({
      inspect: Effect.succeed({ status: "available", id: EMBEDDING_MODEL_ID }),
      install: Effect.succeed({ status: "already_available", id: EMBEDDING_MODEL_ID }),
      embed: (inputs) => {
        const result =
          control.rejectEmbeddings === true
            ? Effect.fail(
                new EmbeddingRuntimeError({ message: "Rejected query embedding for test" }),
              )
            : Effect.succeed(inputs.map(embeddingFor));
        return Effect.sync(() => control.inputs.push(...inputs)).pipe(
          Effect.andThen(control.beforeEmbeddingResult ?? Effect.void),
          Effect.andThen(result),
        );
      },
    }),
  );

const withRecallRuntime = <A, E, R>(
  control: EmbeddingControl,
  effect: Effect.Effect<A, E, R | EmbeddingModel | BunServices.BunServices>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.merge(BunServices.layer, makeControlledEmbeddingLayer(control)),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const initializeMinimalVault = Effect.fnUntraced(function* (vaultPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const templatePath = yield* bundledVaultTemplatePath();
  yield* fs.copy(templatePath, vaultPath, { overwrite: false });
  yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
  yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
});

describe("semantic recall", () => {
  it.effect("returns the nearest exact-cosine semantic chunk", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-nearest-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "semantic-winner.md"),
            "# Semantic winner\n\nThe approved timeout is 640ms.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "lexical-distractor.md"),
            "# Lexical distractor\n\nThe recall timeout answer is 900ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const question = "What is the recall timeout answer?";
          const response = yield* recall({ vaultPath, question, includeSources: false });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The approved timeout is 640ms.");
          assert.deepStrictEqual(control.inputs, [
            "task: search result | query: What is the recall timeout answer?",
          ]);
        }),
      ),
    );
  });

  it.effect("keeps query embedding failures distinct from semantic search failures", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-query-failure-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            "# Answer\n\nThe indexed answer remains searchable.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];
          control.rejectEmbeddings = true;

          const question = "What is the indexed answer?";
          const result = yield* recall({ vaultPath, question, includeSources: false }).pipe(
            Effect.result,
          );

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "QueryEmbeddingFailed");
            assert.strictEqual(result.failure.message, "Failed to embed the recall question");
          }
          assert.deepStrictEqual(control.inputs, [
            "task: search result | query: What is the indexed answer?",
          ]);
        }),
      ),
    );
  });

  it.effect("reports a search failure after readiness and query embedding succeed", () =>
    Effect.gen(function* () {
      const queryEmbeddingStarted = yield* Deferred.make<void>();
      const continueQueryEmbedding = yield* Deferred.make<void>();
      const control: EmbeddingControl = { inputs: [] };
      return yield* withRecallRuntime(
        control,
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const vaultPath = yield* fs.makeTempDirectoryScoped({
              prefix: "agentic-memory-semantic-recall-search-failure-",
            });
            yield* initializeMinimalVault(vaultPath);
            yield* fs.writeFileString(
              path.join(vaultPath, "notes", "answer.md"),
              "# Answer\n\nThe indexed answer remains searchable.\n",
            );
            yield* synchronizeSemanticIndex(vaultPath);
            control.inputs = [];
            control.beforeEmbeddingResult = Deferred.succeed(queryEmbeddingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(continueQueryEmbedding)),
            );

            const question = "What is the indexed answer?";
            const recallFiber = yield* recall({
              vaultPath,
              question,
              includeSources: false,
            }).pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
            yield* Deferred.await(queryEmbeddingStarted);
            yield* fs.remove(path.join(vaultPath, ".agentic-memory", "index"), {
              recursive: true,
            });
            yield* Deferred.succeed(continueQueryEmbedding, undefined);
            const result = yield* Fiber.join(recallFiber);

            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "SemanticSearchFailed");
              assert.strictEqual(result.failure.message, "Failed to search Agentic Memory");
            }
            assert.deepStrictEqual(control.inputs, [
              "task: search result | query: What is the indexed answer?",
            ]);
          }),
        ),
      );
    }),
  );

  it.effect("excludes sources before selecting the top ten eligible chunks", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-source-budget-",
          });
          yield* initializeMinimalVault(vaultPath);
          for (let index = 0; index < 10; index += 1) {
            yield* fs.writeFileString(
              path.join(vaultPath, "sources", `near-${index}.md`),
              `# Source ${index}\n\nsource-near-${index} must not be recalled.\n`,
            );
          }
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "eligible.md"),
            "# Eligible\n\nThe eligible semantic fallback is the public answer.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const question = "Which indexed memory is the answer?";
          const response = yield* recall({ vaultPath, question, includeSources: false });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The eligible semantic fallback is the public answer.",
          );
        }),
      ),
    );
  });

  it.effect("returns not_found when no eligible semantic chunk exists", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-no-eligible-hit-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "sources", "only-hit.md"),
            "# Only indexed hit\n\nsource-near-only must remain ineligible.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);

          const question = "What eligible memory answers this question?";
          const response = yield* recall({ vaultPath, question, includeSources: false });

          assert.deepStrictEqual(response, {
            status: "not_found",
            question,
            answer: "I don't know based on the available Agentic Memory.",
            warnings: [],
          });
        }),
      ),
    );
  });
});
