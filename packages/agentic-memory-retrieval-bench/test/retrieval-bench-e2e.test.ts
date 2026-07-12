import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, ManagedRuntime, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { afterAll } from "vitest";
import { loadBenchmarkCases } from "../src/BenchmarkCase.ts";
import { runBenchmarkCase, runBenchmarkSuite } from "../src/BenchmarkRunner.ts";
import {
  decodeBenchmarkSuiteResultJson,
  encodeBenchmarkSuiteResultJson,
} from "../src/BenchmarkReport.ts";
import { evaluateHardGates } from "../src/HardGates.ts";

const BenchRuntime = ManagedRuntime.make(BunServices.layer);

const withBenchRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | BunServices.BunServices>) =>
  BenchRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

const fixturePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const packagePath = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const vaultPath = yield* path.fromFileUrl(new URL("../fixtures/basic-vault", import.meta.url));
  const casesPath = yield* path.fromFileUrl(new URL("../fixtures/queries.json", import.meta.url));

  return { packagePath, vaultPath, casesPath };
});

const invokeBenchmarkCli = Effect.fnUntraced(function* (
  packagePath: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make("bun", ["src/bench.ts", ...args], {
    cwd: packagePath,
    stdout: "pipe",
    stderr: "pipe",
  });

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      return yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      );
    }),
  );
});

const findGate = <A extends { readonly name: string }>(
  gates: ReadonlyArray<A>,
  gateName: A["name"],
): A => {
  const gate = gates.find((candidate) => candidate.name === gateName);
  return gate ?? assert.fail(`Expected a ${gateName} hard gate result`);
};

describe("public recall benchmark", () => {
  afterAll(() => BenchRuntime.dispose());

  it.effect(
    "invokes the public recall CLI for every case and evaluates answer-level hard gates",
    () =>
      withBenchRuntime(
        Effect.gen(function* () {
          const { vaultPath, casesPath } = yield* fixturePaths;
          const benchmarkCases = yield* loadBenchmarkCases(casesPath);
          const reports = yield* Effect.forEach(benchmarkCases, (benchmarkCase) =>
            runBenchmarkCase({
              vaultPath,
              benchmarkCase,
            }).pipe(
              Effect.map((report) => ({
                benchmarkCase,
                report,
              })),
            ),
          );

          assert.strictEqual(reports.length, benchmarkCases.length);
          for (const { benchmarkCase, report } of reports) {
            const expectedCommand = [
              "agentic-memory",
              "recall",
              benchmarkCase.question,
              "--vault",
              vaultPath,
              ...(benchmarkCase.includeSources === true ? ["--include-sources"] : []),
              "--json",
            ];
            assert.deepEqual(report.command, expectedCommand);
            assert.strictEqual(report.exitCode, ChildProcessSpawner.ExitCode(0));
            assert.strictEqual(report.stderr, "");
            assert.isAtLeast(report.durationMs, 0);
            assert.deepEqual(report.failedGates, []);
            assert.deepEqual(report.requiredFactsMissing, []);
            assert.deepEqual(report.forbiddenFactsPresent, []);
            assert.strictEqual(report.recallStatus, benchmarkCase.expected.status);
            assert.strictEqual(report.status, "pass", `${benchmarkCase.id} should pass`);
            assert.isTrue(report.hardGates.every((gate) => gate.status === "pass"));
            assert.strictEqual(report.decoded._tag, "decoded");
            assert.strictEqual(findGate(report.hardGates, "stdoutJson").status, "pass");
            assert.strictEqual(findGate(report.hardGates, "status").status, "pass");
            assert.strictEqual(findGate(report.hardGates, "answerMustContain").status, "pass");
            assert.strictEqual(findGate(report.hardGates, "answerMustNotContain").status, "pass");

            if (report.decoded._tag === "decoded") {
              assert.strictEqual(report.decoded.response.status, benchmarkCase.expected.status);
              assert.strictEqual(report.decoded.response.question, benchmarkCase.question);
              assert.deepEqual(report.decoded.response.warnings, []);
              assert.deepEqual(Object.keys(report.decoded.response).toSorted(), [
                "answer",
                "question",
                "status",
                "warnings",
              ]);
            }
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
        const exitCodeGate = findGate(report.hardGates, "exitCode");

        assert.strictEqual(report.status, "fail");
        assert.notStrictEqual(report.exitCode, ChildProcessSpawner.ExitCode(0));
        assert.strictEqual(report.decoded._tag, "decode_failed");
        assert.isAtLeast(report.durationMs, 0);
        assert.include(report.failedGates, "exitCode");
        assert.include(report.failedGates, "stdoutJson");
        assert.deepEqual(report.requiredFactsMissing, benchmarkCase.expected.answerMustContain);
        assert.strictEqual(exitCodeGate.status, "fail");
      }),
    ),
  );

  it.effect("aggregates suite counts, latency, and schema-backed JSON", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const { vaultPath, casesPath } = yield* fixturePaths;
        const benchmarkCases = yield* loadBenchmarkCases(casesPath);
        const report = yield* runBenchmarkSuite({ vaultPath, benchmarkCases });
        const json = yield* encodeBenchmarkSuiteResultJson(report);
        const decoded = yield* decodeBenchmarkSuiteResultJson(json);

        assert.strictEqual(report.status, "pass");
        assert.strictEqual(report.caseCount, benchmarkCases.length);
        assert.strictEqual(report.passCount, benchmarkCases.length);
        assert.strictEqual(report.failCount, 0);
        assert.isAtLeast(report.latency.p50Ms, 0);
        assert.isAtLeast(report.latency.p95Ms, report.latency.p50Ms);
        assert.deepEqual(decoded, {
          status: report.status,
          runner: report.runner,
          caseCount: report.caseCount,
          passCount: report.passCount,
          failCount: report.failCount,
          latency: report.latency,
          cases: report.cases.map((benchmarkCase) => ({
            id: benchmarkCase.id,
            status: benchmarkCase.status,
            durationMs: benchmarkCase.durationMs,
            failedGates: benchmarkCase.failedGates,
            requiredFactsMissing: benchmarkCase.requiredFactsMissing,
            forbiddenFactsPresent: benchmarkCase.forbiddenFactsPresent,
            command: benchmarkCase.command,
            recallStatus: benchmarkCase.recallStatus,
          })),
        });
      }),
    ),
  );

  it.effect("emits valid JSON from the benchmark CLI", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const { packagePath } = yield* fixturePaths;
        const result = yield* invokeBenchmarkCli(packagePath, ["--json"]);
        const report = yield* decodeBenchmarkSuiteResultJson(result.stdout.trim());

        assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0));
        assert.strictEqual(result.stderr, "");
        assert.strictEqual(report.status, "pass");
        assert.strictEqual(report.failCount, 0);
      }),
    ),
  );

  it.effect("exits nonzero with a valid failed suite JSON report", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const { packagePath } = yield* fixturePaths;
        const result = yield* invokeBenchmarkCli(packagePath, [
          "--json",
          "--vault",
          "/definitely-missing-agentic-memory-vault",
        ]);
        const report = yield* decodeBenchmarkSuiteResultJson(result.stdout.trim());

        assert.notStrictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0));
        assert.strictEqual(report.status, "fail");
        assert.strictEqual(report.passCount, 0);
        assert.strictEqual(report.failCount, report.caseCount);
        assert.isAbove(result.stderr.length, 0);
        assert.isTrue(report.cases.every((benchmarkCase) => benchmarkCase.status === "fail"));
        assert.isTrue(
          report.cases.every((benchmarkCase) => benchmarkCase.failedGates.includes("exitCode")),
        );
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
