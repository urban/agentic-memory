import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, it } from "@effect/vitest";
import { Effect, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { loadCanonicalSuite } from "../src/BenchmarkManifest.ts";
import { makeFakeRecallSubject, runCompleteSuiteWithSubject } from "../src/BenchmarkRunner.ts";
import { prepareCanonicalFixtures } from "../src/FixturePreparation.ts";
import { corpusFingerprint } from "../src/Baseline.ts";

const Runtime = ManagedRuntime.make(BunServices.layer);

it.effect("loads the indivisible two-fixture canonical suite", () =>
  Runtime.contextEffect.pipe(
    Effect.flatMap((context) =>
      Effect.provideContext(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const packagePath = yield* path.fromFileUrl(new URL("..", import.meta.url));
          const suite = yield* loadCanonicalSuite(packagePath);

          assert.strictEqual(suite.id, "recall-canonical");
          assert.deepEqual(
            suite.fixtures.map((fixture) => fixture.id),
            ["project-memory", "user-preferences"],
          );
          assert.strictEqual(suite.cases.length, 16);
          assert.strictEqual(
            suite.cases.find((benchmarkCase) => benchmarkCase.id === "user-option-format-only")
              ?.fixtureId,
            "user-preferences",
          );
          assert.isTrue(
            suite.cases
              .filter((benchmarkCase) => benchmarkCase.id !== "user-option-format-only")
              .every((benchmarkCase) => benchmarkCase.fixtureId === "project-memory"),
          );

          const observations = yield* runCompleteSuiteWithSubject({
            benchmarkCases: suite.cases,
            fixtureVaults: new Map([
              ["project-memory", "/tmp/project-memory"],
              ["user-preferences", "/tmp/user-preferences"],
            ]),
            subject: makeFakeRecallSubject((question) => ({
              status: "not_found",
              question,
              answer: "I don't know based on the available memory.",
              warnings: [],
            })),
          });
          assert.strictEqual(observations.length, 16);

          const preparedIds: Array<string> = [];
          const prepared = yield* prepareCanonicalFixtures({
            fixtures: suite.fixtures,
            prepare: (fixture) =>
              Effect.sync(() => {
                preparedIds.push(fixture.id);
                return `/tmp/${fixture.id}`;
              }),
          });
          assert.deepEqual(preparedIds, ["project-memory", "user-preferences"]);
          assert.strictEqual(prepared.length, 2);
          assert.match(yield* corpusFingerprint(suite), /^sha256:[0-9a-f]{64}$/u);
        }),
        context,
      ),
    ),
  ),
);

afterAll(() => Runtime.dispose());
