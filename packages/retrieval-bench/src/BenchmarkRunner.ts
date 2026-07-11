import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import { Config as EffectConfig, Effect, Option, Path, PlatformError, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  evaluateHardGates,
  type DecodedRecallOutput,
  type GateStatus,
  type HardGateResult,
} from "./HardGates.ts";

type BenchmarkCase = import("./BenchmarkCase.ts").BenchmarkCase;

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
};

export type BenchmarkSuiteReport = {
  readonly status: GateStatus;
  readonly runner: string;
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

const makeCaseReport = (input: {
  readonly benchmarkCase: BenchmarkCase;
  readonly execution: RecallCliExecution;
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
  invokeRecallCli(input).pipe(
    Effect.map((execution) =>
      makeCaseReport({
        benchmarkCase: input.benchmarkCase,
        execution,
      }),
    ),
  );

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
  ).pipe(
    Effect.map((cases) => ({
      status: cases.every((benchmarkCase) => benchmarkCase.status === "pass") ? "pass" : "fail",
      runner: benchRunnerName,
      cases,
    })),
  );
