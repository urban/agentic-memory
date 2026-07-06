import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { loadBenchmarkCases } from "../src/BenchmarkCase.ts";
import { runBenchmarkSuite } from "../src/BenchmarkRunner.ts";
import { makeLexicalProvider } from "../src/providers/LexicalProvider.ts";

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

describe("retrieval benchmark harness", () => {
  afterAll(() => BenchRuntime.dispose());

  it.effect("runs one fixture-vault question through the initial hard gates", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const { vaultPath, casesPath } = yield* fixturePaths;
        const benchmarkCases = yield* loadBenchmarkCases(casesPath);
        const benchmarkCase = benchmarkCases.find(
          (candidate) => candidate.id === "alpha-retry-latency-and-options",
        );

        if (benchmarkCase === undefined) {
          assert.fail("Missing alpha-retry-latency-and-options benchmark case");
        }

        const report = yield* runBenchmarkSuite({
          provider: makeLexicalProvider(),
          vaultPath,
          benchmarkCases: [benchmarkCase],
        });
        const caseReport = report.cases.find(
          (candidate) => candidate.id === "alpha-retry-latency-and-options",
        );

        if (caseReport === undefined) {
          assert.fail("Missing alpha-retry-latency-and-options benchmark report");
        }

        assert.strictEqual(report.status, "pass");
        assert.deepEqual(
          caseReport.hardGates.map((gate) => gate.name),
          ["mustInclude", "mustNotInclude", "preferredTop1", "sourceLeakage", "vaultRelativePaths"],
        );
        assert.deepEqual(
          caseReport.hardGates.map((gate) => gate.status),
          ["pass", "pass", "pass", "pass", "pass"],
        );

        const resultPaths = caseReport.results.map((result) => result.path);
        assert.include(resultPaths, "projects/alpha-product.md");
        assert.include(resultPaths, "notes/alpha-latency-budget.md");
        assert.include(resultPaths, "USER.md");
        assert.notInclude(resultPaths, "notes/beta-retry-policy.md");
        assert.notInclude(resultPaths, "sources/2026-07-01-alpha-scheduler-source.md");
      }),
    ),
  );
});
