import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import {
  decodeBaselineJson,
  judgeFingerprint,
  makeBaseline,
  writeBaselineAtomically,
} from "../src/Baseline.ts";

const Runtime = ManagedRuntime.make(BunServices.layer);
const benchmarkCase = {
  id: "case",
  fixtureId: "project-memory",
  question: "What is the budget?",
  expected: {
    status: "answered",
    referenceAnswer: "The budget is 200ms p95.",
    forbiddenFacts: [],
  },
} as const;

const makeTestBaseline = (score: 0 | 100) =>
  makeBaseline({
    corpusFingerprint: "sha256:corpus",
    createdAt: "2026-08-28T00:00:00.000Z",
    recallRevision: { commit: "abcdef", dirty: false },
    piVersion: "0.84.3",
    run: {
      score,
      metrics: {
        correctCount: score === 100 ? 1 : 0,
        partiallyCorrectCount: 0,
        incorrectCount: score === 0 ? 1 : 0,
        statusAccuracy: 100,
        forbiddenFactViolationCount: 0,
        recallLatencyP50Ms: 10,
        recallLatencyP95Ms: 10,
      },
      cases: [
        {
          benchmarkCase,
          observation: {
            response: {
              status: "answered",
              question: benchmarkCase.question,
              answer: "Use 200ms p95.",
              warnings: [],
            },
            durationMs: 10,
          },
          evaluation: {
            source: "judge",
            outcome: score === 100 ? "correct" : "incorrect",
            score: score === 100 ? 1 : 0,
            rationale: "Test judgment.",
            hardGateViolations: [],
          },
        },
      ],
    },
  });

it.effect("atomically creates and replaces the one strict baseline", () =>
  Runtime.contextEffect.pipe(
    Effect.flatMap((context) =>
      Effect.provideContext(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const baselinePath = path.join(directory, "baselines", "canonical.json");
            yield* writeBaselineAtomically(baselinePath, makeTestBaseline(100));
            yield* writeBaselineAtomically(baselinePath, makeTestBaseline(0));
            const decoded = yield* decodeBaselineJson(yield* fs.readFileString(baselinePath));
            assert.strictEqual(decoded.score, 0);
            assert.strictEqual(decoded.judgeFingerprint, judgeFingerprint());
            assert.deepEqual(yield* fs.readDirectory(path.dirname(baselinePath)), [
              "canonical.json",
            ]);
          }),
        ),
        context,
      ),
    ),
  ),
);

afterAll(() => Runtime.dispose());
