import { makeFakeEmbeddingModelLayer } from "@urban/agentic-memory-core/semantic/EmbeddingModel";
import { Cause, Console, Effect, Exit, FileSystem, ManagedRuntime, Option, Runtime } from "effect";
import { makeAppLayer, runAgenticMemoryCommand } from "../src/cli.ts";

type CliRequirements = import("../src/cli.ts").CliRequirements;

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
  const runtime = ManagedRuntime.make(makeAppLayer(makeFakeEmbeddingModelLayer()));

  const withCliRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | CliRequirements>) =>
    runtime.contextEffect.pipe(Effect.flatMap((context) => Effect.provideContext(effect, context)));

  const runCapturedEffect = (args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const capture = { stdout: "", stderr: "" };
      const exit = yield* runAgenticMemoryCommand(args).pipe(
        Effect.provideService(Console.Console, makeCaptureConsole(capture)),
        Effect.exit,
      );
      return {
        exitCode: exitCodeFromExit(exit),
        stdout: capture.stdout,
        stderr: capture.stderr,
      };
    });

  return {
    dispose: () => runtime.dispose(),
    runCapturedEffect,
    withCliRuntime,
  };
};
