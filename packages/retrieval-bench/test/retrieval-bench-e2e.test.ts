import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { afterAll } from "vitest";
import { loadBenchmarkCases } from "../src/BenchmarkCase.ts";
import { runBenchmarkCase } from "../src/BenchmarkRunner.ts";
import { evaluateHardGates } from "../src/HardGates.ts";

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

  it.effect("invokes the public recall CLI and evaluates answer-level hard gates", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const { vaultPath, casesPath } = yield* fixturePaths;
        const benchmarkCases = yield* loadBenchmarkCases(casesPath);
        const benchmarkCase = benchmarkCases[0];
        if (benchmarkCase === undefined) {
          assert.fail("Expected one recall benchmark case");
        }

        const report = yield* runBenchmarkCase({
          vaultPath,
          benchmarkCase,
        });

        assert.strictEqual(report.command[0], "bun");
        assert.match(report.command[1] ?? "", /packages\/cli\/src\/main\.ts$/u);
        assert.strictEqual(report.command[2], "recall");
        assert.strictEqual(report.command[3], benchmarkCase.question);
        assert.strictEqual(report.command[4], "--vault");
        assert.strictEqual(report.command[5], vaultPath);
        assert.strictEqual(report.command[6], "--json");
        assert.strictEqual(report.exitCode, ChildProcessSpawner.ExitCode(0));
        assert.strictEqual(report.stderr, "");
        assert.strictEqual(report.status, "pass");
        assert.isTrue(report.hardGates.every((gate) => gate.status === "pass"));
        assert.strictEqual(report.decoded._tag, "decoded");

        if (report.decoded._tag === "decoded") {
          assert.strictEqual(report.decoded.response.status, "answered");
          assert.strictEqual(report.decoded.response.question, benchmarkCase.question);
          assert.include(report.decoded.response.answer, "200ms p95");
          assert.include(report.decoded.response.answer, "stack-ranked");
          assert.include(report.decoded.response.answer, "capital-letter");
          assert.notInclude(report.decoded.response.answer, "5 second batch retry window");
          assert.deepEqual(report.decoded.response.warnings, []);
        }
      }),
    ),
  );

  it.effect("fails the case when the public recall CLI exits nonzero", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const { casesPath } = yield* fixturePaths;
        const benchmarkCases = yield* loadBenchmarkCases(casesPath);
        const benchmarkCase = benchmarkCases[0];
        if (benchmarkCase === undefined) {
          assert.fail("Expected one recall benchmark case");
        }

        const report = yield* runBenchmarkCase({
          vaultPath: "/definitely-missing-agentic-memory-vault",
          benchmarkCase,
        });
        const exitCodeGate = report.hardGates.find((gate) => gate.name === "exitCode");
        if (exitCodeGate === undefined) {
          assert.fail("Expected an exitCode hard gate result");
        }

        assert.strictEqual(report.status, "fail");
        assert.notStrictEqual(report.exitCode, ChildProcessSpawner.ExitCode(0));
        assert.strictEqual(report.decoded._tag, "decode_failed");
        assert.strictEqual(exitCodeGate.status, "fail");
      }),
    ),
  );

  it.effect("normalizes answer hard gates across case and whitespace", () =>
    withBenchRuntime(
      Effect.sync(() => {
        const gateReport = evaluateHardGates({
          benchmarkCase: {
            expected: {
              status: "answered",
              answerMustContain: ["200ms p95", "stack-ranked", "capital-letter"],
              answerMustNotContain: ["5 second batch retry window"],
            },
          },
          execution: {
            exitCode: ChildProcessSpawner.ExitCode(0),
            stdout: '{"status":"answered"}',
            decoded: {
              _tag: "decoded",
              response: {
                status: "answered",
                question: "question",
                answer:
                  "Use 200MS   p95 latency guidance and present STACK-RANKED\nCAPITAL-LETTER choices.",
                warnings: [],
              },
            },
          },
        });

        assert.strictEqual(gateReport.status, "pass");
        assert.isTrue(gateReport.gates.every((gate) => gate.status === "pass"));
      }),
    ),
  );
});
