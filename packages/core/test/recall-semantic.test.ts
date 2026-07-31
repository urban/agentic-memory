import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { createClient } from "@libsql/client";
import { bundledVaultTemplatePath } from "@urban/agentic-memory-vault-template/VaultTemplatePackage";
import {
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Path,
  PlatformError,
} from "effect";
import { encodeRecallSuccessJson, recall } from "../src/recall/Recall.ts";
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
  const evidenceRank = input.match(/evidence-rank-(\d+)/u)?.[1];
  if (evidenceRank !== undefined) return vector(1, Number(evidenceRank) / 100, 0);
  if (input.includes("route-only-nearest")) return vector(1, 0.01, 0);
  if (input.includes("safe-scrubbed-answer")) return vector(0.98, 0.2, 0);
  if (input.includes("substantive-map-answer")) return vector(0.96, 0.28, 0);
  if (input.includes("linked-route-answer")) return vector(0, 0, 1);
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

const executeSemanticIndexSql = Effect.fnUntraced(function* (vaultPath: string, sql: string) {
  const path = yield* Path.Path;
  const databaseUrl = yield* path.toFileUrl(
    path.join(vaultPath, ".agentic-memory", "index", "recall.db"),
  );
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createClient({ url: databaseUrl.href })),
    (client) => Effect.promise(() => client.execute(sql)),
    (client) => Effect.sync(() => client.close()),
  );
});

const recallSingleAnswerDocument = Effect.fnUntraced(function* (
  control: EmbeddingControl,
  prefix: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix });
  yield* initializeMinimalVault(vaultPath);
  yield* fs.writeFileString(path.join(vaultPath, "notes", "answer.md"), content);
  yield* synchronizeSemanticIndex(vaultPath);
  control.inputs = [];
  return yield* recall({
    vaultPath,
    question: "What is the deployment timeout?",
  });
});

describe("semantic recall", () => {
  it.effect("answers from the current Markdown chunk instead of the indexed snippet", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-hydration-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "authoritative.md"),
            "# Authoritative\n\nThe current Markdown answer is 640ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          yield* executeSemanticIndexSql(
            vaultPath,
            "UPDATE chunks SET text = 'The private indexed snippet says 900ms.' WHERE document_path = 'notes/authoritative.md'",
          );
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the current Markdown answer?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The current Markdown answer is 640ms.");
        }),
      ),
    );
  });

  it.effect("fails when the selected ordinal is missing from current Markdown", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-missing-ordinal-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            "# Answer\n\nThe approved timeout is 640ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          yield* executeSemanticIndexSql(
            vaultPath,
            "UPDATE chunks SET ordinal = 99 WHERE document_path = 'notes/answer.md'",
          );
          control.inputs = [];

          const result = yield* recall({
            vaultPath,
            question: "What is the approved timeout?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "EvidenceHydrationFailed");
            assert.include(result.failure.message, "ordinal");
          }
        }),
      ),
    );
  });

  it.effect("fails when indexed provenance no longer matches current Markdown", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-provenance-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            "# Answer\n\nThe approved timeout is 640ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          yield* executeSemanticIndexSql(
            vaultPath,
            "UPDATE chunks SET text_hash = 'private-stale-provenance' WHERE document_path = 'notes/answer.md'",
          );
          control.inputs = [];

          const result = yield* recall({
            vaultPath,
            question: "What is the approved timeout?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "EvidenceHydrationFailed");
            assert.include(result.failure.message, "provenance");
          }
        }),
      ),
    );
  });

  it.effect("reports a managed Markdown read failure during hydration", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-hydration-failure-",
          });
          yield* initializeMinimalVault(vaultPath);
          const notePath = path.join(vaultPath, "notes", "answer.md");
          yield* fs.writeFileString(notePath, "# Answer\n\nThe approved timeout is 640ms.\n");
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          let answerReads = 0;
          const permissionDenied = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "readFileString",
            pathOrDescriptor: notePath,
          });
          const hydrationFailureFileSystem = FileSystem.FileSystem.of({
            ...fs,
            readFileString: (entryPath, encoding) => {
              if (entryPath !== notePath) return fs.readFileString(entryPath, encoding);
              answerReads += 1;
              return answerReads === 3
                ? Effect.fail(permissionDenied)
                : fs.readFileString(entryPath, encoding);
            },
          });

          const result = yield* recall({
            vaultPath,
            question: "What is the approved timeout?",
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, hydrationFailureFileSystem),
            Effect.result,
          );

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "EvidenceHydrationFailed");
            assert.strictEqual(
              result.failure.message,
              "Failed to hydrate current Agentic Memory evidence",
            );
          }
        }),
      ),
    );
  });

  it.effect("preserves exact-cosine order in the interim evidence answer", () => {
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
          const response = yield* recall({ vaultPath, question });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            ["The approved timeout is 640ms.", "The recall timeout answer is 900ms."].join("\n\n"),
          );
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
          const result = yield* recall({ vaultPath, question }).pipe(Effect.result);

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

  it.effect("rejects an indexed chunk after managed memory changes during embedding", () =>
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
              prefix: "agentic-memory-semantic-recall-stale-during-query-",
            });
            yield* initializeMinimalVault(vaultPath);
            const notePath = path.join(vaultPath, "notes", "answer.md");
            yield* fs.writeFileString(
              notePath,
              "# Answer\n\nThe obsolete indexed answer is 640ms.\n",
            );
            yield* synchronizeSemanticIndex(vaultPath);
            control.inputs = [];
            control.beforeEmbeddingResult = Deferred.succeed(queryEmbeddingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(continueQueryEmbedding)),
            );

            const recallFiber = yield* recall({
              vaultPath,
              question: "What is the indexed answer?",
            }).pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
            yield* Deferred.await(queryEmbeddingStarted);
            yield* fs.writeFileString(notePath, "# Answer\n\nThe current answer is 900ms.\n");
            yield* Deferred.succeed(continueQueryEmbedding, undefined);
            const result = yield* Fiber.join(recallFiber);

            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "SemanticIndexStale");
            }
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
          const response = yield* recall({ vaultPath, question });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The eligible semantic fallback is the public answer.",
          );
        }),
      ),
    );
  });

  it.effect("skips route-only passages without expanding their links", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-route-only-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "maps", "routes.md"),
            [
              "# Routes",
              "",
              "- [[notes/linked-answer]] — route-only-nearest. Read when: answering the question.",
              "",
            ].join("\n"),
          );
          for (let index = 0; index < 8; index += 1) {
            yield* fs.writeFileString(
              path.join(vaultPath, "maps", `routes-${index}.md`),
              `# Routes ${index}\n\nRead the route-only-nearest map document for routing.\n`,
            );
          }
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "linked-answer.md"),
            "# Linked answer\n\nThe linked-route-answer must not be expanded from the route.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "eligible.md"),
            "# Eligible\n\nThe eligible semantic fallback is the public answer.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the public answer?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The eligible semantic fallback is the public answer.",
          );
        }),
      ),
    );
  });

  it.effect("scrubs wikilinks and Markdown routing syntax", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-link-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "- [[notes/private-runbook]] — internal route. Read when: deploying.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "[[");
          assert.notInclude(encoded, "Read when:");
        }),
      ),
    );
  });

  it.effect("scrubs relative and absolute document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-path-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "The relative document path is notes/private-runbook.md.",
              "",
              "The absolute document path is /Users/example/private-runbook.md.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "notes/");
          assert.notInclude(encoded, "/Users/");
        }),
      ),
    );
  });

  it.effect("scrubs generic document paths while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-generic-relative-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See docs/private-runbook.md for details. The private runbook is at /srv/deploy/private-runbook.txt.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook.md");
          assert.notInclude(encoded, "/srv/deploy/private-runbook.txt");
        }),
      ),
    );
  });

  it.effect("scrubs adjacent inline-code absolute paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-adjacent-inline-code-path-",
            ["# Answer", "", "The safe-scrubbed-answer is safe. Use`/private/runbook`.", ""].join(
              "\n",
            ),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The safe-scrubbed-answer is safe.");
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "/private/runbook");
        }),
      ),
    );
  });

  it.effect("scrubs relative document paths regardless of file extension", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-relative-document-path-extension-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See docs/private-runbook.txt for details. Open config/secrets.yaml for deployment credentials.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook.txt");
          assert.notInclude(encoded, "config/secrets.yaml");
        }),
      ),
    );
  });

  it.effect("scrubs extensionless relative document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-extensionless-relative-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See docs/private-runbook for details.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs extensionless document paths introduced by consult", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-consult-extensionless-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Consult docs/private-runbook before rollout.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs extensionless document paths in ordinary prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-extensionless-ordinary-prose-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer supports read/write access, and operators deploy using blue/green releases. The deployment runbook location is docs/private-runbook. The deployment runbook is located at docs/private-runbook. Deploy using docs/runbook.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer supports read/write access, and operators deploy using blue/green releases.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
          assert.notInclude(encoded, "docs/runbook");
        }),
      ),
    );
  });

  it.effect("scrubs colon-labeled extensionless document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-extensionless-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Deployment runbook: docs/private-runbook.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs colon-labeled extensionless paths before trailing prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-path-trailing-prose-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Deployment runbook: docs/private-runbook; operators review it before rollout.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs colon-labeled bare document filenames", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-bare-filename-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Deployment runbook: private-runbook.md.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "private-runbook.md");
        }),
      ),
    );
  });

  it.effect("scrubs inline-code extensionless document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-inline-code-extensionless-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. The deployment runbook is located at `docs/private-runbook`.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs emphasized colon-labeled inline-code document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-emphasized-colon-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. **Deployment runbook:** **`docs/private-runbook`**.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs multi-backtick extensionless document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-multi-backtick-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. The deployment runbook is located at ``docs/private-runbook``.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("preserves inline ordered prose while removing physical list prefixes", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer =
            "The rollout has two phases. 1) Prepare the cluster. 2) Deploy the service.";
          const inlineResponse = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-inline-ordered-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(inlineResponse.status, "answered");
          assert.strictEqual(inlineResponse.answer, answer);

          const listResponse = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-ordered-list-prefix-",
            ["# Answer", "", `1) ${answer}`, ""].join("\n"),
          );

          assert.strictEqual(listResponse.status, "answered");
          assert.strictEqual(listResponse.answer, answer);
        }),
      ),
    );
  });

  it.effect("preserves substantive slash-delimited prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer =
            "The safe-scrubbed-answer supports read/write access, blue/green deployment, 24/7 coverage, the 2026/07/30 release date, and 100 requests/second.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, answer);
        }),
      ),
    );
  });

  it.effect("preserves slash prose near document terms", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer =
            "The safe-scrubbed-answer document format is read/write access. The file mode is read/write.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-document-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, answer);
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.include(encoded, "read/write");
        }),
      ),
    );
  });

  it.effect("scrubs dot-relative document paths while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-dot-relative-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Open ./private-runbook.md for details.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "./private-runbook.md");
        }),
      ),
    );
  });

  it.effect("scrubs ordinary provider and model labels while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-provider-model-label-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Provider: Anthropic. Model: gpt-4o.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "Anthropic");
          assert.notInclude(encoded, "gpt-4o");
        }),
      ),
    );
  });

  it.effect("scrubs reference-style Markdown links while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-reference-link-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See [private runbook][runbook].",
              "",
              "[runbook]: docs/private-runbook.md",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "[private runbook][runbook]");
          assert.notInclude(encoded, "[runbook]:");
        }),
      ),
    );
  });

  it.effect("scrubs control-plane names from the public response", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-control-plane-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "Internal control-plane file: .agentic-memory/LLM-vault-local.md.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, ".agentic-memory");
          assert.notInclude(encoded, "LLM-vault-local");
        }),
      ),
    );
  });

  it.effect("scrubs evidence, provider, and model implementation details", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-metadata-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "Evidence ID E1 has vector score 0.998 and ordinal 4.",
              "",
              "Provider detail: llama-server. Model detail: agentic-memory-qwen3-4b.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "Evidence ID");
          assert.notInclude(encoded, "vector score");
          assert.notInclude(encoded, "llama-server");
          assert.notInclude(encoded, "qwen");
        }),
      ),
    );
  });

  it.effect("keeps substantive root and map prose eligible after scrubbing", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-map-prose-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            [
              "# Memory",
              "",
              "The substantive-map-answer is a 640ms deployment timeout.",
              "",
              "- [[maps/deployments]] — deployment routes. Read when: deploying.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The substantive-map-answer is a 640ms deployment timeout.",
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
          const response = yield* recall({ vaultPath, question });

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

  it.effect("preserves inline-code slash prose in document contexts", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer = "The safe-scrubbed-answer document is available in `read/write` mode.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-inline-code-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer document is available in read/write mode.",
          );
        }),
      ),
    );
  });

  it.effect("preserves colon-labeled slash prose in location contexts", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer = "The safe-scrubbed-answer uses a deployment location: blue/green.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-labeled-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, answer);
        }),
      ),
    );
  });

  it.effect("keeps semantic order while limiting interim evidence to five documents", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-evidence-order-",
          });
          yield* initializeMinimalVault(vaultPath);
          for (let rank = 1; rank <= 6; rank += 1) {
            yield* fs.writeFileString(
              path.join(vaultPath, "notes", `evidence-${rank}.md`),
              `# evidence-rank-${rank}\n\nThe ranked evidence passage is ${rank}.\n`,
            );
          }
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What are the ranked evidence passages?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            Array.from(
              { length: 5 },
              (_, index) => `The ranked evidence passage is ${index + 1}.`,
            ).join("\n\n"),
          );
        }),
      ),
    );
  });

  it.effect("selects at most two interim passages from one document", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-document-budget-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "primary.md"),
            [1, 2, 3]
              .map(
                (rank) =>
                  `# evidence-rank-${rank}\n\nThe primary document evidence passage is ${rank}.\n`,
              )
              .join("\n"),
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "secondary.md"),
            "# evidence-rank-4\n\nThe secondary document evidence passage is 4.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What are the document-budget evidence passages?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            [
              "The primary document evidence passage is 1.",
              "The primary document evidence passage is 2.",
              "The secondary document evidence passage is 4.",
            ].join("\n\n"),
          );
        }),
      ),
    );
  });

  it.effect("deduplicates repeated and overlapping interim passages", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-evidence-deduplication-",
          });
          yield* initializeMinimalVault(vaultPath);
          const firstPassage =
            "The first ranked fact is retained. The shared boundary fact appears once.";
          const documents: ReadonlyArray<readonly [number, string]> = [
            [1, firstPassage],
            [2, "The shared boundary fact appears once. The second ranked fact is also retained."],
            [3, firstPassage],
          ];
          for (const [rank, passage] of documents) {
            yield* fs.writeFileString(
              path.join(vaultPath, "notes", `deduplication-${rank}.md`),
              `# evidence-rank-${rank}\n\n${passage}\n`,
            );
          }
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "Which deduplicated facts should be retained?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            [firstPassage, "The second ranked fact is also retained."].join("\n\n"),
          );
        }),
      ),
    );
  });

  it.effect("deduplicates repeated facts within one interim passage", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-internal-evidence-deduplication-",
            [
              "# evidence-rank-1",
              "",
              "- The repeated packet fact appears once.",
              "- The repeated packet fact appears once.",
              "- The repeated packet fact appears once.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The repeated packet fact appears once.");
        }),
      ),
    );
  });

  it.effect("omits passages that would exceed the interim evidence token budget", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-evidence-token-budget-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "oversized.md"),
            `# evidence-rank-1\n\n${"x".repeat(18_004)}\n`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "bounded.md"),
            "# evidence-rank-2\n\nThe bounded evidence passage remains available.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "Which evidence fits the packet budget?",
          });
          const encoded = yield* encodeRecallSuccessJson(response);

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The bounded evidence passage remains available.");
          assert.notInclude(encoded, "E1");
          assert.notInclude(encoded, vaultPath);
        }),
      ),
    );
  });
});
