import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Console, Effect, ManagedRuntime, Path, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { afterAll } from "vitest";
import { loadBenchmarkCases } from "../src/BenchmarkCase.ts";
import { runBenchmarkCase, runBenchmarkSuite } from "../src/BenchmarkRunner.ts";
import {
  decodeBenchmarkSuiteResultJson,
  encodeBenchmarkSuiteResultJson,
} from "../src/BenchmarkReport.ts";
import { runBenchmarkCli } from "../src/bench.ts";
import { evaluateHardGates } from "../src/HardGates.ts";

const BenchRuntime = ManagedRuntime.make(BunServices.layer);

type RecallResponse = import("@urban/agentic-memory-core/recall/Recall").RecallResponse;

const fakeRecallResponse = (question: string): RecallResponse => {
  const normalized = question.toLocaleLowerCase();
  const answer =
    normalized.includes("gamma project") || normalized.includes("coffee grinder")
      ? "I don't know based on the available memory."
      : normalized.includes("verification evidence")
        ? "The trial recorded a 180ms observed p95 verification threshold."
        : normalized.includes("beta platform")
          ? "Use the 5 second batch retry window."
          : normalized.includes("why was")
            ? "The budget was chosen to protect user-facing flows."
            : normalized.includes("before resuming")
              ? "Preserve responsiveness over throughput."
              : normalized.includes("planning context")
                ? "Treat scheduler work as interaction-design constraints."
                : normalized.includes("frame scheduler")
                  ? "Use interaction-design constraints, not background-job tuning."
                  : normalized.includes("present") && normalized.includes("alpha")
                    ? "Use the 200ms p95 budget and present stack-ranked capital-letter options."
                    : normalized.includes("present prioritization")
                      ? "Present stack-ranked capital-letter options."
                      : "Use the 200ms p95 latency budget.";
  return {
    status:
      normalized.includes("gamma project") || normalized.includes("coffee grinder")
        ? "not_found"
        : "answered",
    question,
    answer,
    warnings: [],
  };
};

const fakeRecallSpawner = ChildProcessSpawner.make((command) => {
  if (!ChildProcess.isStandardCommand(command)) {
    return Effect.die("The benchmark fake accepts only standard commands");
  }
  const vaultFlagIndex = command.args.indexOf("--vault");
  const vaultPath = vaultFlagIndex < 0 ? undefined : command.args[vaultFlagIndex + 1];
  const missingVault = vaultPath === "/definitely-missing-agentic-memory-vault";
  const question = command.args[1] ?? "";
  const stdout = missingVault ? "" : `${JSON.stringify(fakeRecallResponse(question))}\n`;
  const stderr = missingVault ? "SemanticIndexNotReady: Semantic index is missing\n" : "";
  const exitCode = ChildProcessSpawner.ExitCode(missingVault ? 1 : 0);
  const encode = (text: string) => new TextEncoder().encode(text);
  return Effect.succeed(
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(12345),
      stdin: Sink.drain,
      stdout: stdout.length === 0 ? Stream.empty : Stream.make(encode(stdout)),
      stderr: stderr.length === 0 ? Stream.empty : Stream.make(encode(stderr)),
      all: Stream.make(encode(`${stdout}${stderr}`)),
      exitCode: Effect.succeed(exitCode),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    }),
  );
});

const withBenchRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | BunServices.BunServices>) =>
  BenchRuntime.contextEffect.pipe(
    Effect.flatMap((context) =>
      Effect.provideContext(
        effect.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, fakeRecallSpawner),
        ),
        context,
      ),
    ),
  );

const fixturePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const vaultPath = yield* path.fromFileUrl(new URL("../fixtures/basic-vault", import.meta.url));
  const casesPath = yield* path.fromFileUrl(new URL("../fixtures/queries.json", import.meta.url));

  return { vaultPath, casesPath };
});

const makeCaptureConsole = (capture: { stdout: string; stderr: string }): Console.Console => ({
  assert(): void {},
  clear(): void {},
  count(): void {},
  countReset(): void {},
  debug(): void {},
  dir(): void {},
  dirxml(): void {},
  error: (...args) => {
    capture.stderr += `${args.map(String).join(" ")}\n`;
  },
  group(): void {},
  groupCollapsed(): void {},
  groupEnd(): void {},
  info(): void {},
  log: (...args) => {
    capture.stdout += `${args.map(String).join(" ")}\n`;
  },
  table(): void {},
  time(): void {},
  timeEnd(): void {},
  timeLog(): void {},
  trace(): void {},
  warn(): void {},
});

const runCapturedBenchmarkCli = (args: ReadonlyArray<string>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      return previousExitCode;
    }),
    () => {
      const capture = { stdout: "", stderr: "" };
      return runBenchmarkCli(args).pipe(
        Effect.provideService(Console.Console, makeCaptureConsole(capture)),
        Effect.as(capture),
      );
    },
    (previousExitCode) => Effect.sync(() => void (process.exitCode = previousExitCode)),
  );

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
        const output = yield* runCapturedBenchmarkCli(["--json"]);
        const report = yield* decodeBenchmarkSuiteResultJson(output.stdout.trim());

        assert.strictEqual(output.stderr, "");
        assert.strictEqual(report.status, "pass");
        assert.strictEqual(report.failCount, 0);
      }),
    ),
  );

  it.effect("exits nonzero with a valid failed suite JSON report", () =>
    withBenchRuntime(
      Effect.gen(function* () {
        const output = yield* runCapturedBenchmarkCli([
          "--json",
          "--vault",
          "/definitely-missing-agentic-memory-vault",
        ]);
        const report = yield* decodeBenchmarkSuiteResultJson(output.stdout.trim());

        assert.strictEqual(report.status, "fail");
        assert.strictEqual(report.passCount, 0);
        assert.strictEqual(report.failCount, report.caseCount);
        assert.isAbove(output.stderr.length, 0);
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
