import { Config as EffectConfig, Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  StewardRunner,
  StewardRunnerError,
  type StewardRunOptions,
  type StewardRunnerRequest,
} from "./StewardExecution.ts";
import { decodeStewardResultJson, type StewardResult } from "./StewardResult.ts";

export interface PiProcessCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMillis: number | undefined;
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

const decodeAssistantMessageEndEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(AssistantMessageEndEvent),
);

const optionalEnvironmentVariable = Effect.fnUntraced(
  function* (name: string) {
    const value = yield* EffectConfig.string(name).pipe(EffectConfig.option);
    return Option.getOrUndefined(value);
  },
  Effect.catch(() => Effect.sync((): string | undefined => undefined)),
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

export const buildPiProcessCommand = (input: {
  readonly piBinary: string;
  readonly request: StewardRunnerRequest;
}): PiProcessCommand => {
  const baseArgs = [
    "--mode",
    "json",
    "--no-session",
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
  const collectOutput = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command).pipe(
        Effect.mapError(
          (cause) =>
            new StewardRunnerError({
              message: `Failed to launch Memory Steward command: ${processCommand.command}`,
              cause,
            }),
        ),
      );
      return yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new StewardRunnerError({
              message: "Failed while collecting Memory Steward process output",
              cause,
            }),
        ),
      );
    }),
  );

  if (processCommand.timeoutMillis === undefined) {
    return yield* collectOutput;
  }

  return yield* collectOutput.pipe(
    Effect.timeoutOrElse({
      duration: processCommand.timeoutMillis,
      orElse: () =>
        Effect.fail(
          new StewardRunnerError({
            message: "Timed out waiting for steward final JSON after child process launch",
          }),
        ),
    }),
  );
});

const decodeProcessResult = Effect.fnUntraced(function* (input: {
  readonly processResult: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: ChildProcessSpawner.ExitCode;
  };
}): Effect.fn.Return<StewardResult, StewardRunnerError> {
  if (input.processResult.exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new StewardRunnerError({
      message: "Steward process exited with non-zero status before emitting final JSON",
      cause: {
        stdout: input.processResult.stdout,
        stderr: input.processResult.stderr,
      },
    });
  }

  const assistantText = extractAssistantText(input.processResult.stdout);
  if (assistantText.trim().length === 0) {
    return yield* new StewardRunnerError({
      message: "Steward returned EOF before final assistant JSON response was emitted",
      cause: {
        stdout: input.processResult.stdout,
        stderr: input.processResult.stderr,
      },
    });
  }

  return yield* decodeStewardResultJson(assistantText).pipe(
    Effect.mapError(
      (cause) =>
        new StewardRunnerError({
          message: "Steward returned invalid final JSON for capture result schema",
          cause,
        }),
    ),
  );
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
      return yield* decodeProcessResult({ processResult });
    });

    return StewardRunner.of({
      name: "pi-process",
      run,
    });
  }),
);
