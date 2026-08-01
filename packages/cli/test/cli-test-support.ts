import {
  EmbeddingModel,
  makeFakeEmbeddingModelLayer,
} from "@urban/agentic-memory-core/semantic/EmbeddingModel";
import {
  EvidenceEchoRecallSynthesisLayer,
  RecallSynthesis,
} from "@urban/agentic-memory-core/recall/RecallSynthesis";
import {
  Cause,
  ConfigProvider,
  Console,
  Effect,
  Exit,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Runtime,
} from "effect";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import { makeAppLayer, runAgenticMemoryCommand } from "../src/cli.ts";

type CliRequirements = import("../src/cli.ts").CliRequirements;
type CliTestRequirements =
  | CliRequirements
  | EmbeddingModel
  | RecallSynthesis
  | HttpClient.HttpClient;

const unavailableHttpClient = HttpClient.make((request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request, cause: "Disabled in CLI tests" }),
    }),
  ),
);

const formatConsoleArgs = (args: ReadonlyArray<unknown>): string => args.map(String).join(" ");

export const fakeFileInfo = (type: FileSystem.File.Type): FileSystem.File.Info => ({
  type,
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
});

const makeCaptureConsole = (capture: { stdout: string; stderr: string }): Console.Console => ({
  assert(condition: boolean, ...args: ReadonlyArray<unknown>): void {
    if (!condition) {
      capture.stderr += `${formatConsoleArgs(args)}\n`;
    }
  },
  clear(): void {},
  count(_label?: string): void {},
  countReset(_label?: string): void {},
  debug(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  dir(item: unknown): void {
    capture.stdout += `${String(item)}\n`;
  },
  dirxml(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  error(...args: ReadonlyArray<unknown>): void {
    capture.stderr += `${formatConsoleArgs(args)}\n`;
  },
  group(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  groupCollapsed(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  groupEnd(): void {},
  info(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  log(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  table(tabularData: unknown): void {
    capture.stdout += `${String(tabularData)}\n`;
  },
  time(_label?: string): void {},
  timeEnd(_label?: string): void {},
  timeLog(_label?: string, ...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  trace(...args: ReadonlyArray<unknown>): void {
    capture.stderr += `${formatConsoleArgs(args)}\n`;
  },
  warn(...args: ReadonlyArray<unknown>): void {
    capture.stderr += `${formatConsoleArgs(args)}\n`;
  },
});

const exitCodeFromExit = (exit: Exit.Exit<void, unknown>): number =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

export const makeCliTestRuntime = () => {
  const runtime = ManagedRuntime.make(
    makeAppLayer(
      makeFakeEmbeddingModelLayer(),
      EvidenceEchoRecallSynthesisLayer,
      Layer.succeed(HttpClient.HttpClient, unavailableHttpClient),
    ),
  );

  const withCliRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | CliTestRequirements>) =>
    runtime.contextEffect.pipe(Effect.flatMap((context) => Effect.provideContext(effect, context)));

  const captureCommand = <E, R>(command: Effect.Effect<void, E, R>) =>
    Effect.gen(function* () {
      const capture = { stdout: "", stderr: "" };
      const exit = yield* command.pipe(
        Effect.provideService(Console.Console, makeCaptureConsole(capture)),
        Effect.exit,
      );
      return {
        exitCode: exitCodeFromExit(exit),
        stdout: capture.stdout,
        stderr: capture.stderr,
      };
    });

  const runCapturedEffect = (args: ReadonlyArray<string>) =>
    captureCommand(runAgenticMemoryCommand(args));

  const runCapturedEffectWithEmbeddingModel = (
    args: ReadonlyArray<string>,
    embeddingModel: EmbeddingModel["Service"],
  ) =>
    captureCommand(
      runAgenticMemoryCommand(args).pipe(Effect.provideService(EmbeddingModel, embeddingModel)),
    );

  const runCapturedEffectWithRecallSynthesis = (
    args: ReadonlyArray<string>,
    recallSynthesis: RecallSynthesis["Service"],
  ) =>
    captureCommand(
      runAgenticMemoryCommand(args).pipe(Effect.provideService(RecallSynthesis, recallSynthesis)),
    );

  const runCapturedEffectWithSynthesisStatus = (
    args: ReadonlyArray<string>,
    endpoint: string | undefined,
    httpClient: HttpClient.HttpClient,
  ) =>
    captureCommand(
      runAgenticMemoryCommand(args).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: endpoint === undefined ? {} : { AGENTIC_MEMORY_SYNTHESIS_URL: endpoint },
          }),
        ),
      ),
    );

  return {
    dispose: () => runtime.dispose(),
    runCapturedEffect,
    runCapturedEffectWithEmbeddingModel,
    runCapturedEffectWithRecallSynthesis,
    runCapturedEffectWithSynthesisStatus,
    withCliRuntime,
  };
};
