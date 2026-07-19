import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import { Clock, Config as EffectConfig, Effect, Option, Path, PlatformError, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { evaluateHardGates } from "./HardGates.ts";

type BenchmarkCase = import("./BenchmarkCase.ts").BenchmarkCase;
type DecodedRecallOutput = import("./HardGates.ts").DecodedRecallOutput;
type GateStatus = import("./HardGates.ts").GateStatus;
type HardGateResult = import("./HardGates.ts").HardGateResult;
type BenchmarkHardGateName = import("./BenchmarkReport.ts").BenchmarkHardGateName;

const benchLauncherDirectoryFileUrl = new URL("../bin/", import.meta.url);
const repoRootFileUrl = new URL("../../..", import.meta.url);
const benchRunnerName = "agentic-memory recall";

const fileUrlToKnownPath = (path: Path.Path, url: URL): Effect.Effect<string, never> =>
  path.fromFileUrl(url).pipe(Effect.catchTag("BadArgument", (error) => Effect.die(error)));

const optionalEnvironmentVariable = Effect.fn("BenchmarkRunner.optionalEnvironmentVariable")(
  function* (name: string) {
    const value = yield* EffectConfig.string(name).pipe(EffectConfig.option);
    return Option.getOrUndefined(value);
  },
  Effect.catch(() => Effect.sync((): string | undefined => undefined)),
);

const pathWithPrependedBin = (
  path: Path.Path,
  binDirectoryPath: string,
  currentPath: string | undefined,
): string => {
  const pathListSeparator = path.sep === "\\" ? ";" : ":";
  return currentPath === undefined || currentPath.length === 0
    ? binDirectoryPath
    : `${binDirectoryPath}${pathListSeparator}${currentPath}`;
};

type RecallCliExecution = {
  readonly command: ReadonlyArray<string>;
  readonly exitCode: ChildProcessSpawner.ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  readonly decoded: DecodedRecallOutput;
};

export type BenchmarkCaseReport = {
  readonly id: string;
  readonly status: GateStatus;
  readonly command: ReadonlyArray<string>;
  readonly exitCode: ChildProcessSpawner.ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  readonly decoded: DecodedRecallOutput;
  readonly hardGates: ReadonlyArray<HardGateResult>;
  readonly durationMs: number;
  readonly failedGates: ReadonlyArray<BenchmarkHardGateName>;
  readonly requiredFactsMissing: ReadonlyArray<string>;
  readonly forbiddenFactsPresent: ReadonlyArray<string>;
  readonly recallStatus?: "answered" | "not_found";
};

export type BenchmarkSuiteReport = {
  readonly status: GateStatus;
  readonly runner: string;
  readonly caseCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly latency: {
    readonly p50Ms: number;
    readonly p95Ms: number;
  };
  readonly cases: ReadonlyArray<BenchmarkCaseReport>;
};

const resolveCliPaths = Effect.fnUntraced(function* (): Effect.fn.Return<
  {
    readonly benchLauncherDirectoryPath: string;
    readonly repoRootPath: string;
    readonly commandPath: string;
  },
  never,
  Path.Path
> {
  const path = yield* Path.Path;
  const benchLauncherDirectoryPath = yield* fileUrlToKnownPath(path, benchLauncherDirectoryFileUrl);
  const repoRootPath = yield* fileUrlToKnownPath(path, repoRootFileUrl);
  const currentPath = yield* optionalEnvironmentVariable("PATH");

  return {
    benchLauncherDirectoryPath,
    repoRootPath,
    commandPath: pathWithPrependedBin(path, benchLauncherDirectoryPath, currentPath),
  };
});

const decodeRecallOutput = (stdout: string): Effect.Effect<DecodedRecallOutput, never> =>
  decodeRecallSuccessJson(stdout.trim()).pipe(
    Effect.map(
      (response) =>
        ({
          _tag: "decoded",
          response,
        }) satisfies DecodedRecallOutput,
    ),
    Effect.catch((cause) =>
      Effect.succeed({
        _tag: "decode_failed",
        message: cause.message,
      } satisfies DecodedRecallOutput),
    ),
  );

const invokeRecallCli = Effect.fnUntraced(function* (input: {
  readonly vaultPath: string;
  readonly benchmarkCase: BenchmarkCase;
}): Effect.fn.Return<
  RecallCliExecution,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { commandPath, repoRootPath } = yield* resolveCliPaths();
  const cliArgs = [
    "recall",
    input.benchmarkCase.question,
    "--vault",
    input.vaultPath,
    ...(input.benchmarkCase.includeSources === true ? ["--include-sources"] : []),
    "--json",
  ] satisfies ReadonlyArray<string>;
  const command = ChildProcess.make("agentic-memory", [...cliArgs], {
    cwd: repoRootPath,
    env: {
      PATH: commandPath,
    },
    extendEnv: true,
    stdout: "pipe",
    stderr: "pipe",
  });

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      const result = yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      );
      const decoded = yield* decodeRecallOutput(result.stdout);

      return {
        command: ["agentic-memory", ...cliArgs],
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        decoded,
      };
    }),
  );
});

const violationsForGate = (
  hardGates: ReadonlyArray<HardGateResult>,
  name: BenchmarkHardGateName,
): ReadonlyArray<string> => hardGates.find((gate) => gate.name === name)?.violations ?? [];

const makeCaseReport = (input: {
  readonly benchmarkCase: BenchmarkCase;
  readonly execution: RecallCliExecution;
  readonly durationMs: number;
}): BenchmarkCaseReport => {
  const hardGateReport = evaluateHardGates({
    benchmarkCase: input.benchmarkCase,
    execution: {
      exitCode: input.execution.exitCode,
      stdout: input.execution.stdout,
      decoded: input.execution.decoded,
    },
  });

  return {
    id: input.benchmarkCase.id,
    status: hardGateReport.status,
    command: input.execution.command,
    exitCode: input.execution.exitCode,
    stdout: input.execution.stdout,
    stderr: input.execution.stderr,
    decoded: input.execution.decoded,
    hardGates: hardGateReport.gates,
    durationMs: Math.max(0, input.durationMs),
    failedGates: hardGateReport.gates
      .filter((gate) => gate.status === "fail")
      .map((gate) => gate.name),
    requiredFactsMissing: violationsForGate(hardGateReport.gates, "answerMustContain"),
    forbiddenFactsPresent: violationsForGate(hardGateReport.gates, "answerMustNotContain"),
    ...(input.execution.decoded._tag === "decoded"
      ? { recallStatus: input.execution.decoded.response.status }
      : {}),
  };
};

export const runBenchmarkCase = (input: {
  readonly vaultPath: string;
  readonly benchmarkCase: BenchmarkCase;
}): Effect.Effect<
  BenchmarkCaseReport,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const execution = yield* invokeRecallCli(input);
    const finishedAt = yield* Clock.currentTimeMillis;

    return makeCaseReport({
      benchmarkCase: input.benchmarkCase,
      execution,
      durationMs: finishedAt - startedAt,
    });
  });

const percentile = (percent: number, durations: ReadonlyArray<number>): number => {
  const sortedDurations = durations.toSorted((left, right) => left - right);
  if (sortedDurations.length === 0) {
    return 0;
  }

  const index = Math.max(0, Math.ceil(percent * sortedDurations.length) - 1);
  return sortedDurations[index] ?? 0;
};

export const aggregateBenchmarkReports = (
  cases: ReadonlyArray<BenchmarkCaseReport>,
): BenchmarkSuiteReport => {
  const passCount = cases.filter((benchmarkCase) => benchmarkCase.status === "pass").length;
  const failCount = cases.length - passCount;
  const durations = cases.map((benchmarkCase) => benchmarkCase.durationMs);

  return {
    status: failCount === 0 ? "pass" : "fail",
    runner: benchRunnerName,
    caseCount: cases.length,
    passCount,
    failCount,
    latency: {
      p50Ms: percentile(0.5, durations),
      p95Ms: percentile(0.95, durations),
    },
    cases,
  };
};

export const runBenchmarkSuite = (input: {
  readonly vaultPath: string;
  readonly benchmarkCases: ReadonlyArray<BenchmarkCase>;
}): Effect.Effect<
  BenchmarkSuiteReport,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> =>
  Effect.forEach(input.benchmarkCases, (benchmarkCase) =>
    runBenchmarkCase({
      vaultPath: input.vaultPath,
      benchmarkCase,
    }),
  ).pipe(Effect.map(aggregateBenchmarkReports));
