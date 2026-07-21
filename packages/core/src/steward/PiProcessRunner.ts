import { Config as EffectConfig, Effect, Layer, Option, Ref, Schema, Stream } from "effect";
import * as Fiber from "effect/Fiber";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { StewardRunner, StewardRunnerError } from "./StewardExecution.ts";
import { decodeStewardResultJson } from "./StewardResult.ts";

type CaptureCorrelation = import("../observability/CaptureTelemetry.ts").CaptureCorrelation;
type StewardRunnerOutcome = import("./StewardExecution.ts").StewardRunnerOutcome;
type StewardRunOptions = import("./StewardExecution.ts").StewardRunOptions;
type StewardRunnerRequest = import("./StewardExecution.ts").StewardRunnerRequest;
type StewardSessionPointer = import("./StewardExecution.ts").StewardSessionPointer;

export interface PiProcessCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMillis: number | undefined;
  readonly sessionName: string;
}

const AssistantMessageEndEvent = Schema.Struct({
  type: Schema.Literal("message_end"),
  message: Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
      }),
    ),
  }),
}).annotate({ identifier: "AssistantMessageEndEvent" });
type AssistantMessageEndEvent = typeof AssistantMessageEndEvent.Type;

const SessionHeaderEvent = Schema.Struct({
  type: Schema.Literal("session"),
  id: Schema.String,
  cwd: Schema.String,
  timestamp: Schema.String,
}).annotate({ identifier: "StewardSessionHeaderEvent" });
type SessionHeaderEvent = typeof SessionHeaderEvent.Type;

const decodeAssistantMessageEndEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(AssistantMessageEndEvent),
);
const decodeSessionHeaderEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(SessionHeaderEvent),
);

const optionalEnvironmentVariable = Effect.fnUntraced(
  function* (name: string) {
    const value = yield* EffectConfig.string(name).pipe(EffectConfig.option);
    return Option.getOrUndefined(value);
  },
  Effect.orElseSucceed((): string | undefined => undefined),
);

const withOptionalRunnerFlags = (
  baseArgs: ReadonlyArray<string>,
  options: StewardRunOptions,
): ReadonlyArray<string> => {
  const args = [...baseArgs];
  if (options.provider !== undefined) {
    args.push("--provider", options.provider);
  }
  if (options.model !== undefined) {
    args.push("--model", options.model);
  }
  if (options.thinking !== undefined) {
    args.push("--thinking", options.thinking);
  }
  return args;
};

export const stewardSessionName = (correlation: CaptureCorrelation | undefined): string => {
  const suffix = correlation?.attemptId ?? correlation?.captureRunId ?? "manual";
  return `Memory Steward capture ${suffix}`;
};

export const buildPiProcessCommand = (input: {
  readonly piBinary: string;
  readonly request: StewardRunnerRequest;
}): PiProcessCommand => {
  const sessionName = stewardSessionName(input.request.correlation);
  const baseArgs = [
    "--mode",
    "json",
    "--name",
    sessionName,
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--append-system-prompt",
    input.request.context.instructions.outsideVault,
    "-p",
    input.request.context.instructions.prompt,
  ];

  return {
    command: input.piBinary,
    args: withOptionalRunnerFlags(baseArgs, input.request.options),
    cwd: input.request.context.vault.path,
    timeoutMillis: input.request.options.timeoutMillis,
    sessionName,
  };
};

const assistantTextFromEvent = (event: AssistantMessageEndEvent): string =>
  event.message.content
    .filter((block) => block.type === "text" && block.text !== undefined)
    .map((block) => block.text ?? "")
    .join("");

export const extractAssistantText = (
  output: string,
  decodeLine: (
    line: string,
  ) => Option.Option<AssistantMessageEndEvent> = decodeAssistantMessageEndEvent,
): string => {
  let lineEnd = output.length;

  while (lineEnd > 0) {
    while (lineEnd > 0 && (output[lineEnd - 1] === "\n" || output[lineEnd - 1] === "\r")) {
      lineEnd -= 1;
    }

    if (lineEnd === 0) {
      return "";
    }

    const previousNewline = output.lastIndexOf("\n", lineEnd - 1);
    const line = output.slice(previousNewline + 1, lineEnd);
    const decoded = decodeLine(line);
    if (Option.isSome(decoded)) {
      return assistantTextFromEvent(decoded.value);
    }

    lineEnd = previousNewline;
  }

  return "";
};

const firstNonEmptyLine = (output: string): string | undefined => {
  const lines = output.split(/\r?\n/);
  return lines.find((line) => line.trim().length > 0);
};

export const extractStewardSessionPointer = (
  output: string,
  sessionName: string,
): StewardSessionPointer | undefined => {
  const firstLine = firstNonEmptyLine(output);
  if (firstLine === undefined) {
    return undefined;
  }

  const header = decodeSessionHeaderEvent(firstLine);
  return Option.match(header, {
    onNone: () => undefined,
    onSome: (value: SessionHeaderEvent) => ({
      sessionId: value.id,
      name: sessionName,
      cwd: value.cwd,
      startedAt: value.timestamp,
    }),
  });
};

const runProcess = Effect.fnUntraced(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  processCommand: PiProcessCommand,
): Effect.fn.Return<
  {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: ChildProcessSpawner.ExitCode;
  },
  StewardRunnerError
> {
  const command = ChildProcess.make(processCommand.command, [...processCommand.args], {
    cwd: processCommand.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const appendDecodedStream = (
    stream: Stream.Stream<Uint8Array, unknown>,
    ref: Ref.Ref<string>,
    channel: "stdout" | "stderr",
  ): Effect.Effect<void, StewardRunnerError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Ref.update(ref, (current) => current + chunk)),
      Effect.mapError(
        (cause) =>
          new StewardRunnerError({
            message: `Failed while collecting Memory Steward process ${channel}`,
            cause,
          }),
      ),
    );

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const stdoutRef = yield* Ref.make("");
      const stderrRef = yield* Ref.make("");
      const handle = yield* spawner.spawn(command).pipe(
        Effect.mapError(
          (cause) =>
            new StewardRunnerError({
              message: `Failed to launch Memory Steward command: ${processCommand.command}`,
              cause,
            }),
        ),
      );
      const stdoutFiber = yield* appendDecodedStream(handle.stdout, stdoutRef, "stdout").pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      const stderrFiber = yield* appendDecodedStream(handle.stderr, stderrRef, "stderr").pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      const collectOutput = handle.exitCode.pipe(
        Effect.flatMap((exitCode) =>
          Effect.all([
            Fiber.join(stdoutFiber),
            Fiber.join(stderrFiber),
            Effect.all({
              stdout: Ref.get(stdoutRef),
              stderr: Ref.get(stderrRef),
              exitCode: Effect.succeed(exitCode),
            }),
          ]),
        ),
        Effect.map(([, , processResult]) => processResult),
        Effect.mapError(
          (cause) =>
            new StewardRunnerError({
              message: "Failed while collecting Memory Steward process output",
              cause,
            }),
        ),
      );

      if (processCommand.timeoutMillis === undefined) {
        return yield* collectOutput;
      }

      return yield* collectOutput.pipe(
        Effect.timeoutOrElse({
          duration: processCommand.timeoutMillis,
          orElse: () =>
            Effect.gen(function* () {
              const stdout = yield* Ref.get(stdoutRef);
              const stderr = yield* Ref.get(stderrRef);
              const stewardSession = extractStewardSessionPointer(
                stdout,
                processCommand.sessionName,
              );

              return yield* new StewardRunnerError({
                message: "Timed out waiting for steward final JSON after child process launch",
                cause: processOutputDiagnostics({ stdout, stderr }),
                ...(stewardSession === undefined ? {} : { stewardSession }),
              });
            }),
        }),
      );
    }),
  );
});

const processOutputDiagnostics = (input: {
  readonly stdout: string;
  readonly stderr: string;
}): Record<string, unknown> => ({
  stdoutLength: input.stdout.length,
  stderrLength: input.stderr.length,
});

const decodeProcessResult = Effect.fnUntraced(function* (input: {
  readonly processResult: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: ChildProcessSpawner.ExitCode;
  };
  readonly sessionName: string;
}): Effect.fn.Return<StewardRunnerOutcome, StewardRunnerError> {
  const stewardSession = extractStewardSessionPointer(
    input.processResult.stdout,
    input.sessionName,
  );

  if (input.processResult.exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new StewardRunnerError({
      message: "Steward process exited with non-zero status before emitting final JSON",
      cause: processOutputDiagnostics(input.processResult),
      ...(stewardSession === undefined ? {} : { stewardSession }),
    });
  }

  const assistantText = extractAssistantText(input.processResult.stdout);
  if (assistantText.trim().length === 0) {
    return yield* new StewardRunnerError({
      message: "Steward returned EOF before final assistant JSON response was emitted",
      cause: processOutputDiagnostics(input.processResult),
      ...(stewardSession === undefined ? {} : { stewardSession }),
    });
  }

  const result = yield* decodeStewardResultJson(assistantText).pipe(
    Effect.mapError(
      (cause) =>
        new StewardRunnerError({
          message: "Steward returned invalid final JSON for capture result schema",
          cause,
          ...(stewardSession === undefined ? {} : { stewardSession }),
        }),
    ),
  );

  return stewardSession === undefined ? { result } : { result, stewardSession };
});

export const PiProcessRunnerLayer: Layer.Layer<
  StewardRunner,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  StewardRunner,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const piBinary = (yield* optionalEnvironmentVariable("AGENTIC_MEMORY_PI_BIN")) ?? "pi";
    const run = Effect.fnUntraced(function* (request: StewardRunnerRequest) {
      const command = buildPiProcessCommand({ piBinary, request });
      const processResult = yield* runProcess(spawner, command);
      return yield* decodeProcessResult({
        processResult,
        sessionName: command.sessionName,
      });
    });

    return StewardRunner.of({
      name: "pi-process",
      run,
    });
  }),
);
