import { Console, Effect, Schema } from "effect";
import { commandRoot } from "./commands/root.ts";
import { CliCommandExit, CliCommandFailure } from "./failures.ts";

export { CliCommandExit, CliCommandFailure, exitWith, toFailure } from "./failures.ts";

export const CliError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "CliError" });
export type CliError = typeof CliError.Type;

export const CliFailureResult = Schema.Struct({
  status: Schema.Literal("failed"),
  error: CliError,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "CliFailureResult" });
export type CliFailureResult = typeof CliFailureResult.Type;

export const CliFailureResultJson = Schema.fromJsonString(CliFailureResult).annotate({
  identifier: "CliFailureResultJson",
});
export const encodeCliFailureResultJson = Schema.encodeUnknownEffect(CliFailureResultJson);
export const decodeCliFailureResultJson = Schema.decodeUnknownEffect(CliFailureResultJson);

const encodeFailureJson = (failure: CliCommandFailure): Effect.Effect<string> => {
  const result: CliFailureResult = {
    status: "failed",
    error: {
      code: failure.code,
      message: failure.message,
    },
    warnings: failure.warnings ?? [],
  };

  return encodeCliFailureResultJson(result).pipe(
    Effect.orElseSucceed(
      () =>
        '{"status":"failed","error":{"code":"InternalCliError","message":"Failed to encode CLI error"},"warnings":[]}',
    ),
  );
};

export const writeFailure = (failure: CliCommandFailure, json: boolean): Effect.Effect<void> =>
  json
    ? encodeFailureJson(failure).pipe(
        Effect.flatMap((jsonText) =>
          Effect.all(
            [Console.log(jsonText), Console.error(`${failure.code}: ${failure.message}`)],
            {
              concurrency: 1,
              discard: true,
            },
          ),
        ),
      )
    : Console.error(failure.message);

export const failWithOutput = Effect.fnUntraced(function* (
  failure: CliCommandFailure,
  json: boolean,
) {
  yield* writeFailure(failure, json);
  return yield* failure;
});

type CliOutputFailure = CliCommandFailure | CliCommandExit;
type RootCommandContext = import("effect/unstable/cli").Command.CommandContext<"agentic-memory">;

export const withCliFailureOutput = <A, R>(
  self: Effect.Effect<A, CliOutputFailure, R>,
): Effect.Effect<A, CliOutputFailure, R | RootCommandContext> =>
  self.pipe(
    Effect.catchTag("CliCommandFailure", (failure) =>
      Effect.gen(function* () {
        const root = yield* commandRoot;
        return yield* failWithOutput(failure, root.json);
      }),
    ),
  );
