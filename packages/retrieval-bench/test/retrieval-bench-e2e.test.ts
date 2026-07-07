import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { loadBenchmarkCases } from "../src/BenchmarkCase.ts";

const BenchRuntime = ManagedRuntime.make(BunServices.layer);

const withBenchRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | BunServices.BunServices>) =>
  BenchRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

const fixturePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const vaultPath = yield* path.fromFileUrl(new URL("../fixtures/basic-vault", import.meta.url));
  const casesPath = yield* path.fromFileUrl(new URL("../fixtures/queries.json", import.meta.url));

  return { vaultPath, casesPath };
});

const forbiddenAssertionMarkers = [
  "projects/",
  "notes/",
  "maps/",
  "records/",
  "sources/",
  "MEMORY.md",
  "USER.md",
  "[[",
  ".agentic-memory",
];

const fixtureFacts = [
  {
    path: "projects/alpha-product.md",
    snippet: "200ms p95 latency budget",
  },
  {
    path: "USER.md",
    snippet: "stack-ranked capital-letter choices",
  },
  {
    path: "notes/user-option-format.md",
    snippet: "capital-letter options and invite a stack-ranked reply",
  },
  {
    path: "notes/beta-retry-policy.md",
    snippet: "5 second batch retry window",
  },
] as const;

describe("retrieval benchmark fixtures", () => {
  afterAll(() => BenchRuntime.dispose());

  it.effect("loads the Alpha/Beta recall case without internal path assertions", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { casesPath } = yield* fixturePaths;
        const rawCases = yield* fs.readFileString(casesPath);
        const benchmarkCases = yield* loadBenchmarkCases(casesPath);

        const benchmarkCase = benchmarkCases[0];
        if (benchmarkCase === undefined) {
          assert.fail("Expected one recall benchmark case");
        }

        assert.strictEqual(benchmarkCases.length, 1);
        assert.strictEqual(benchmarkCase.id, "alpha-retry-latency-and-options");
        assert.strictEqual(
          benchmarkCase.question,
          "In Alpha Product, I need to tune the retry scheduler. What latency budget decision should I follow, and how should I present options back to Urban?",
        );
        assert.strictEqual(benchmarkCase.expected.status, "answered");
        assert.deepEqual(benchmarkCase.expected.answerMustContain, [
          "200ms p95",
          "stack-ranked",
          "capital-letter",
        ]);
        assert.deepEqual(benchmarkCase.expected.answerMustNotContain, [
          "5 second batch retry window",
        ]);

        for (const marker of forbiddenAssertionMarkers) {
          assert.notInclude(rawCases, marker);
        }
      }),
    ),
  );

  it.effect("keeps the required Alpha facts and Beta distractor in the fixture vault", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { vaultPath } = yield* fixturePaths;

        for (const fixtureFact of fixtureFacts) {
          const contents = yield* fs.readFileString(path.join(vaultPath, fixtureFact.path));
          assert.include(contents, fixtureFact.snippet);
        }
      }),
    ),
  );
});
