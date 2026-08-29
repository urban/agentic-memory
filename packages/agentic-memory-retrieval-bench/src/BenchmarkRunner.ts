import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import {
  Clock,
  Config,
  Duration,
  Effect,
  Option,
  Path,
  PlatformError,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

type BenchmarkCase = import("./BenchmarkCase.ts").BenchmarkCase;
type RecallResponse = import("@urban/agentic-memory-core/recall/Recall").RecallResponse;

const launcherDirectoryUrl = new URL("../bin/", import.meta.url);
const repositoryRootUrl = new URL("../../..", import.meta.url);

export type ProcessExecution = {
  readonly command: ReadonlyArray<string>;
  readonly exitCode: ChildProcessSpawner.ExitCode;
  readonly stdout: string;
  readonly stderr: string;
};

export class BenchmarkProcessTimeout extends Schema.TaggedError<BenchmarkProcessTimeout>()(
  "BenchmarkProcessTimeout",
  { command: Schema.String },
) {}

export type RecallObservation = { readonly response: RecallResponse; readonly durationMs: number };
export class RecallSubjectFailure extends Schema.TaggedError<RecallSubjectFailure>()(
  "RecallSubjectFailure",
  {
    reason: Schema.Literals(["process", "decode", "question_mismatch"]),
    message: Schema.String,
  },
) {}
export type RecallSubject = {
  readonly run: (input: {
    readonly question: string;
    readonly vaultPath: string;
  }) => Effect.Effect<RecallObservation, RecallSubjectFailure>;
};

const optionalPath = Config.string("PATH").pipe(
  Config.option,
  Effect.map(Option.getOrUndefined),
  Effect.orElseSucceed((): string | undefined => undefined),
);

export const runBenchmarkProcess = Effect.fnUntraced(function* (
  commandName: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Effect.fn.Return<
  ProcessExecution,
  PlatformError.PlatformError | PlatformError.BadArgument | BenchmarkProcessTimeout,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const repositoryRoot = yield* path.fromFileUrl(repositoryRootUrl);
  const launcherDirectory = yield* path.fromFileUrl(launcherDirectoryUrl);
  const currentPath = yield* optionalPath;
  const separator = path.sep === "\\" ? ";" : ":";
  const executablePath =
    currentPath === undefined || currentPath.length === 0
      ? launcherDirectory
      : `${launcherDirectory}${separator}${currentPath}`;
  const command = ChildProcess.make(commandName, [...args], {
    cwd: repositoryRoot,
    env: { PATH: executablePath },
    extendEnv: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      const output = yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      );
      return { command: [commandName, ...args], ...output };
    }),
  ).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(BenchmarkProcessTimeout.make({ command: commandName })),
    ),
  );
});

export const runAgenticMemoryCli = (args: ReadonlyArray<string>) =>
  runBenchmarkProcess("agentic-memory", args, args[0] === "recall" ? 120_000 : 900_000);

export const makePublicCliRecallSubject = Effect.fnUntraced(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const run = Effect.fn("RecallSubject.run")(function* (input: {
    readonly question: string;
    readonly vaultPath: string;
  }) {
    const startedAt = yield* Clock.currentTimeMillis;
    const execution = yield* runAgenticMemoryCli([
      "recall",
      input.question,
      "--vault",
      input.vaultPath,
      "--json",
    ]).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(Path.Path, path),
      Effect.mapError((error) =>
        RecallSubjectFailure.make({ reason: "process", message: String(error) }),
      ),
    );
    if (execution.exitCode !== ChildProcessSpawner.ExitCode(0)) {
      return yield* RecallSubjectFailure.make({
        reason: "process",
        message: execution.stderr.trim() || `Recall exited ${String(execution.exitCode)}.`,
      });
    }
    const response = yield* decodeRecallSuccessJson(execution.stdout.trim()).pipe(
      Effect.mapError((error) =>
        RecallSubjectFailure.make({ reason: "decode", message: error.message }),
      ),
    );
    if (response.question !== input.question) {
      return yield* RecallSubjectFailure.make({
        reason: "question_mismatch",
        message: "Recall response question did not match the requested question.",
      });
    }
    return {
      response,
      durationMs: Math.max(0, (yield* Clock.currentTimeMillis) - startedAt),
    };
  });
  return { run } satisfies RecallSubject;
});

export const makeFakeRecallSubject = (
  respond: (question: string) => RecallResponse,
): RecallSubject => ({
  run: ({ question }) => Effect.succeed({ response: respond(question), durationMs: 0 }),
});

export const runCompleteSuiteWithSubject = (input: {
  readonly benchmarkCases: ReadonlyArray<BenchmarkCase>;
  readonly fixtureVaults: ReadonlyMap<string, string>;
  readonly subject: RecallSubject;
}): Effect.Effect<ReadonlyArray<RecallObservation>, RecallSubjectFailure> =>
  Effect.forEach(input.benchmarkCases, (benchmarkCase) => {
    const vaultPath = input.fixtureVaults.get(benchmarkCase.fixtureId);
    return vaultPath === undefined
      ? Effect.fail(
          RecallSubjectFailure.make({
            reason: "process",
            message: `Prepared fixture missing: ${benchmarkCase.fixtureId}`,
          }),
        )
      : input.subject.run({ question: benchmarkCase.question, vaultPath });
  });
