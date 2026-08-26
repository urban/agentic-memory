import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import {
  RecallSynthesis,
  RecallSynthesisError,
} from "@urban/agentic-memory-core/recall/RecallSynthesis";
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
const recallQuestion = "In Alpha Product, what latency budget should I follow?";
const expectedRecallAnswer = [
  "When asking the user to choose between options, present the choices as capital-letter options and invite a stack-ranked reply, for example C > A > B.",
  "2026-07-01: Added distractor retry policy.",
  "2026-07-01: Accepted the Alpha scheduler latency decision.",
  "Beta Platform uses background batch retries where throughput matters more than responsiveness.",
  "Beta Platform uses a 5 second batch retry window. This applies only to Beta Platform background batch processing.",
  "Do not use this note for Alpha Product interactive scheduler prompts.",
].join("\n\n");
const {
  dispose,
  runCapturedEffect,
  runCapturedEffectWithEmbeddingModel,
  runCapturedEffectWithRecallSynthesis,
  withCliRuntime,
} = makeCliTestRuntime();

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

  it.effect("maps multipart questions to split-request guidance before reading the vault", () =>
    withCliRuntime(
      runCapturedEffect([
        "recall",
        "What latency budget applies, and why was it chosen?",
        "--vault",
        "/vault/that/should/not/be-inspected",
        "--json",
      ]),
    ).pipe(
      Effect.flatMap((output) =>
        decodeCliFailureResultJson(output.stdout).pipe(
          Effect.map((failure) => ({ failure, output })),
        ),
      ),
      Effect.map(({ failure, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.strictEqual(failure.error.code, "UnsupportedMultipartQuestion");
        assert.include(failure.error.message, "separate recall commands");
        assert.notInclude(failure.error.message, "/vault/that/should/not/be-inspected");
      }),
    ),
  );

  it.effect("maps blank questions to stable invalid-question guidance", () =>
    withCliRuntime(
      runCapturedEffect([
        "recall",
        "   ",
        "--vault",
        "/vault/that/should/not-be-inspected",
        "--json",
      ]),
    ).pipe(
      Effect.flatMap((output) =>
        decodeCliFailureResultJson(output.stdout).pipe(
          Effect.map((failure) => ({ failure, output })),
        ),
      ),
      Effect.map(({ failure, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.strictEqual(failure.error.code, "InvalidRecallQuestion");
        assert.include(failure.error.message, "must not be empty");
        assert.notInclude(failure.error.message, "/vault/that/should/not-be-inspected");
      }),
    ),
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
        assert.strictEqual(decoded.answer, expectedRecallAnswer);
        assert.deepStrictEqual(decoded.warnings, []);
      }),
    ),
  );

  it.effect("maps every synthesis failure to stable local-server guidance", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const cases: ReadonlyArray<
            readonly [
              RecallSynthesisError["reason"],
              (
                | "SynthesisConfigurationMissing"
                | "SynthesisConfigurationInvalid"
                | "SynthesisEndpointNotLoopback"
                | "SynthesisServerUnavailable"
                | "SynthesisServerIncompatible"
                | "SynthesisStructuredOutputFailed"
              ),
            ]
          > = [
            ["MissingConfiguration", "SynthesisConfigurationMissing"],
            ["InvalidConfiguration", "SynthesisConfigurationInvalid"],
            ["NonLoopbackEndpoint", "SynthesisEndpointNotLoopback"],
            ["ServerUnavailable", "SynthesisServerUnavailable"],
            ["ServerIncompatible", "SynthesisServerIncompatible"],
            ["MalformedStructuredOutput", "SynthesisStructuredOutputFailed"],
          ];

          for (const [reason, expectedCode] of cases) {
            const synthesis = RecallSynthesis.of({
              synthesize: () =>
                Effect.fail(
                  RecallSynthesisError.make({
                    reason,
                    message: "Private prompt, evidence E1, provider response, and /tmp/model.gguf",
                  }),
                ),
            });
            const output = yield* runCapturedEffectWithRecallSynthesis(
              ["recall", recallQuestion, "--vault", vaultPath, "--json"],
              synthesis,
            );
            const failure = yield* decodeCliFailureResultJson(output.stdout);

            assert.strictEqual(output.exitCode, 1);
            assert.strictEqual(failure.error.code, expectedCode);
            assert.notInclude(failure.error.message, "Private prompt");
            assert.notInclude(failure.error.message, "E1");
            assert.notInclude(failure.error.message, "provider response");
            assert.notInclude(failure.error.message, "/tmp/model.gguf");
          }
        }),
      ),
    ),
  );

  it.effect("maps grounding failures without exposing synthesis internals", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) => {
        const unsafeAnswer = "Amazon Bedrock read private/alpha for the answer.";
        const unsafeClaim = "Llama 3.1 70B derived the claim from the prompt.";
        const synthesis = RecallSynthesis.of({
          synthesize: () =>
            Effect.succeed({
              status: "answered",
              answer: unsafeAnswer,
              claim: unsafeClaim,
              evidenceIds: ["E1"],
              providerModelIdentity: "present",
            }),
        });
        return runCapturedEffectWithRecallSynthesis(
          ["recall", recallQuestion, "--vault", vaultPath, "--json"],
          synthesis,
        ).pipe(
          Effect.flatMap((output) =>
            decodeCliFailureResultJson(output.stdout).pipe(
              Effect.map((failure) => ({ failure, output })),
            ),
          ),
        );
      }),
    ).pipe(
      Effect.map(({ failure, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.strictEqual(failure.error.code, "GroundingValidationFailed");
        for (const unsafeValue of ["Amazon Bedrock", "private/alpha", "Llama 3.1 70B", "prompt"]) {
          assert.notInclude(output.stdout, unsafeValue);
          assert.notInclude(output.stderr, unsafeValue);
        }
      }),
    ),
  );

  it.effect("rejects generalized retrieval-ranking prose at the CLI boundary", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const cases = [
            {
              answer: "Use MEMORY_ADAPTER for the deployment details.",
              claim: "The deployment details are available.",
            },
            {
              answer: "The deployment details are available.",
              claim: "The MEMORY_ADAPTER contains the deployment details.",
            },
            {
              answer: "Retrieval placed the deployment timeout first overall.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer:
                "Retrieval placed the deployment timeout first chronologically among the candidates.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer:
                "Retrieval placed the deployment timeout first **chronologically** among the candidates.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed the deployment timeout first _overall_ before filtering.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval ordered the deployment timeout first and returned it.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed the deployment timeout first overall.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed the deployment timeout first overall before filtering.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim:
                "Retrieval placed the deployment timeout first **chronologically** among the candidates.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed the deployment timeout first _overall_ before filtering.",
            },
            {
              answer: "Retrieval placed this first overall before filtering.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed this **first** overall before filtering.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed this first chrono**logically** among the candidates.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed this `first` overall before filtering.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed this first overall.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed this first chronologically.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Retrieval placed this first secondly.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first overall before filtering.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this **first** overall before filtering.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first chrono`logically` among the candidates.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first overall.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first chronologically.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first secondly.",
            },
            {
              answer: "Retrieval placed this first chronologically among the candidates.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first chronologically among the candidates.",
            },
            {
              answer: "Retrieval placed this first chronologically in the candidate list.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first chronologically in the candidate list.",
            },
            {
              answer: "Retrieval placed this first secondly in the candidate list.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first secondly in the candidate list.",
            },
            {
              answer: "Retrieval placed this first recently in the candidate list.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first recently in the candidate list.",
            },
            {
              answer: "Retrieval placed this first recently in the results.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first recently in the results.",
            },
            {
              answer: "Retrieval placed this first recently within the options.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first recently within the options.",
            },
            {
              answer: "Retrieval placed that first secondly in the shortlist.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed that first secondly in the shortlist.",
            },
            {
              answer: "Retrieval placed this first family in temporary housing first.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed this first family in temporary housing first.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval ordered the deployment timeout first and returned it.",
            },
            {
              answer: "Retrieval placed records with the user-selected labels highest.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed records with the user-selected labels highest.",
            },
            {
              answer: "Retrieval placed the candidate the team preferred at the top.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed the candidate the team preferred at the top.",
            },
            {
              answer: "Retrieval placed the candidate after the user-selected labels at the top.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed the candidate after the user-selected labels at the top.",
            },
            {
              answer: "Retrieval placed records before the archived candidates highest.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed records before the archived candidates highest.",
            },
            {
              answer: "Retrieval placed records before the eligible candidates highest.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim: "Retrieval placed records before the eligible candidates highest.",
            },
            {
              answer:
                "Retrieval placed the notes before the archived project candidate records at the top.",
              claim: "The deployment timeout is 640ms.",
            },
            {
              answer: "Use a 640ms deployment timeout.",
              claim:
                "Retrieval placed the notes before the archived project candidate records at the top.",
            },
          ];

          for (const { answer, claim } of cases) {
            const synthesis = RecallSynthesis.of({
              synthesize: () =>
                Effect.succeed({
                  status: "answered",
                  answer,
                  claim,
                  evidenceIds: ["E1"],
                  providerModelIdentity: "absent",
                }),
            });
            const output = yield* runCapturedEffectWithRecallSynthesis(
              ["recall", recallQuestion, "--vault", vaultPath, "--json"],
              synthesis,
            );
            const failure = yield* decodeCliFailureResultJson(output.stdout);

            assert.strictEqual(output.exitCode, 1);
            assert.strictEqual(failure.error.code, "GroundingValidationFailed");
            assert.notInclude(failure.error.message, answer);
            assert.notInclude(failure.error.message, claim);
          }
        }),
      ),
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

  it.effect("reports a missing vault as a vault read failure", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-cli-recall-missing-vault-",
          });
          const vaultPath = path.join(root, "missing-vault");

          const output = yield* runCapturedEffect([
            "recall",
            recallQuestion,
            "--vault",
            vaultPath,
            "--json",
          ]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.error.code, "ReadVaultFailed");
          assert.include(failure.error.message, `agentic-memory status --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, "index --vault");
          assert.notInclude(failure.error.message, "--delete");
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
                    EmbeddingRuntimeError.make({ message: "Rejected embedding for test" }),
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
            (client) =>
              Effect.sync(() => {
                client.close();
              }),
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
            (client) =>
              Effect.sync(() => {
                client.close();
              }),
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
              EmbeddingRuntimeError.make({
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
                    Effect.mapError((cause) =>
                      EmbeddingRuntimeError.make({
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

  it.effect("maps evidence hydration failure without exposing provenance internals", () =>
    withCliRuntime(
      withIndexedRecallFixture((vaultPath) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const databaseUrl = yield* path.toFileUrl(databasePath);
          yield* Effect.acquireUseRelease(
            Effect.sync(() => createClient({ url: databaseUrl.href })),
            (client) =>
              Effect.promise(() => client.execute("UPDATE chunks SET ordinal = ordinal + 1000")),
            (client) =>
              Effect.sync(() => {
                client.close();
              }),
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
          assert.strictEqual(failure.error.code, "EvidenceHydrationFailed");
          assert.include(failure.error.message, `agentic-memory status --vault ${vaultPath}`);
          assert.notInclude(failure.error.message, "ordinal");
          assert.notInclude(failure.error.message, "999");
          assert.notInclude(failure.error.message, "chunks");
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
        assert.strictEqual(result.answer, expectedRecallAnswer);
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
