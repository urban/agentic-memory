import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { ProjectSlug } from "../src/link/ProjectSlug.ts";

const RetrievalEvalCase = Schema.Struct({
  id: Schema.String,
  projectSlug: ProjectSlug,
  prompt: Schema.String,
  requiredFiles: Schema.Array(Schema.String),
  requiredFacts: Schema.Array(Schema.String),
  forbiddenFiles: Schema.Array(Schema.String),
  forbiddenFacts: Schema.Array(Schema.String),
}).annotate({ identifier: "RetrievalEvalCase" });

type RetrievalEvalCase = typeof RetrievalEvalCase.Type;

const RetrievalEvalCasesJson = Schema.fromJsonString(Schema.Array(RetrievalEvalCase)).annotate({
  identifier: "RetrievalEvalCasesJson",
});

const decodeRetrievalEvalCasesJson = Schema.decodeUnknownEffect(RetrievalEvalCasesJson);

const fixtureRoot = fileURLToPath(new URL("./fixtures/retrieval/", import.meta.url));
const queriesPath = fileURLToPath(new URL("./fixtures/retrieval/queries.json", import.meta.url));
const basicVaultPath = fileURLToPath(new URL("./fixtures/retrieval/basic-vault/", import.meta.url));

const CoreFixtureRuntime = ManagedRuntime.make(BunServices.layer);

const readRetrievalEvalCases = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const contents = yield* fs.readFileString(queriesPath);
  return yield* decodeRetrievalEvalCasesJson(contents);
});

const allExpectedFiles = (testCase: RetrievalEvalCase): ReadonlyArray<string> => [
  ...testCase.requiredFiles,
  ...testCase.forbiddenFiles,
];

describe("retrieval evaluation fixtures", () => {
  afterAll(() => CoreFixtureRuntime.dispose());

  it.effect("define gold queries with expected files and facts", () =>
    CoreFixtureRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          readRetrievalEvalCases.pipe(
            Effect.map((cases) => {
              assert.isAtLeast(cases.length, 1);
              assert.strictEqual(cases[0]?.id, "alpha-retry-latency-and-options");
              assert.include(cases[0]?.requiredFiles ?? [], "projects/alpha-product.md");
              assert.include(cases[0]?.requiredFacts.join("\n") ?? "", "200ms p95");
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("keeps every gold file present in the basic vault fixture", () =>
    CoreFixtureRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const cases = yield* readRetrievalEvalCases;
            const expectedFiles = cases.flatMap(allExpectedFiles);

            for (const expectedFile of expectedFiles) {
              const exists = yield* fs.exists(path.join(basicVaultPath, expectedFile));
              assert.isTrue(exists, `${expectedFile} should exist under ${fixtureRoot}`);
            }
          }),
          context,
        ),
      ),
    ),
  );
});
