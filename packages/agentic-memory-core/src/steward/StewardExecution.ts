import { Cause, Context, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import type { CapturePayload } from "../capture/CapturePayload.ts";
import type { ProjectSlug } from "../link/ProjectSlug.ts";
import {
  buildStewardContext,
  StewardContextError,
  type StewardContextResult,
} from "./StewardContext.ts";
import { StewardResult, type StewardResult as StewardResultValue } from "./StewardResult.ts";

export const RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MILLIS = [1_000, 2_000];

export const StewardRunnerName = Schema.Literal("pi-process").annotate({
  identifier: "StewardRunnerName",
});
export type StewardRunnerName = typeof StewardRunnerName.Type;

export const StewardExecutionInfo = Schema.Struct({
  runner: StewardRunnerName,
  attempts: Schema.Number,
}).annotate({ identifier: "StewardExecutionInfo" });
export type StewardExecutionInfo = typeof StewardExecutionInfo.Type;

export const RunStewardResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("succeeded"),
    result: StewardResult,
    execution: StewardExecutionInfo,
    retryFailureReasons: Schema.Array(Schema.String),
    warnings: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    execution: StewardExecutionInfo,
    retryFailureReasons: Schema.Array(Schema.String),
    warnings: Schema.Array(Schema.String),
  }),
]).annotate({ identifier: "RunStewardResult" });
export type RunStewardResult = typeof RunStewardResult.Type;

export const RunStewardResultJson = Schema.fromJsonString(RunStewardResult).annotate({
  identifier: "RunStewardResultJson",
});
export const encodeRunStewardResultJson = Schema.encodeUnknownEffect(RunStewardResultJson);
export const decodeRunStewardResultJson = Schema.decodeUnknownEffect(RunStewardResultJson);

export interface StewardRunOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly timeoutMillis?: number;
}

export interface StewardRunnerRequest {
  readonly context: StewardContextResult;
  readonly options: StewardRunOptions;
}

export class StewardRunnerError extends Schema.TaggedErrorClass<StewardRunnerError>()(
  "StewardRunnerError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class StewardRunner extends Context.Service<
  StewardRunner,
  {
    readonly name: StewardRunnerName;
    readonly run: (
      request: StewardRunnerRequest,
    ) => Effect.Effect<StewardResultValue, StewardRunnerError>;
  }
>()("@urban/agentic-memory-core/steward/StewardExecution/StewardRunner") {}

export const normalizeRetryFailureReason = (message: string): string => {
  const words = message
    .replace(/\s+/g, " ")
    .replace(/Cause\([^)]*\)/g, "")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);
  const paddedWords = [
    ...words,
    "during",
    "isolated",
    "Memory",
    "Steward",
    "capture",
    "send",
    "attempt",
  ];
  return paddedWords.slice(0, 15).join(" ");
};

const backoffForAttemptIndex = (attemptIndex: number): number =>
  RETRY_BACKOFF_MILLIS[attemptIndex - 1] ?? 0;

export const runSteward = Effect.fnUntraced(function* (input: {
  readonly payload: CapturePayload;
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
  readonly payloadWarnings: ReadonlyArray<string>;
  readonly options: StewardRunOptions;
}): Effect.fn.Return<
  RunStewardResult,
  StewardContextError,
  FileSystem.FileSystem | Path.Path | StewardRunner
> {
  const runner = yield* StewardRunner;
  const context = yield* buildStewardContext({
    payload: input.payload,
    vaultPath: input.vaultPath,
    projectSlug: input.projectSlug,
    payloadWarnings: input.payloadWarnings,
  });
  const retryFailureReasons: string[] = [];
  let attemptIndex = 0;

  while (attemptIndex < RETRY_ATTEMPTS) {
    const result = yield* runner.run({ context, options: input.options }).pipe(Effect.exit);
    if (result._tag === "Success") {
      return {
        status: "succeeded",
        result: result.value,
        execution: {
          runner: runner.name,
          attempts: attemptIndex + 1,
        },
        retryFailureReasons,
        warnings: [...input.payloadWarnings, ...result.value.warnings],
      };
    }

    retryFailureReasons.push(normalizeRetryFailureReason(Cause.pretty(result.cause)));
    attemptIndex += 1;
    if (attemptIndex < RETRY_ATTEMPTS) {
      yield* Effect.sleep(backoffForAttemptIndex(attemptIndex));
    }
  }

  return {
    status: "failed",
    execution: {
      runner: runner.name,
      attempts: RETRY_ATTEMPTS,
    },
    retryFailureReasons,
    warnings: [...input.payloadWarnings],
  };
});

export const stewardRunnerSuccessLayer = (result: StewardResultValue): Layer.Layer<StewardRunner> =>
  Layer.succeed(
    StewardRunner,
    StewardRunner.of({
      name: "pi-process",
      run: (_request: StewardRunnerRequest) => Effect.succeed(result),
    }),
  );

export const stewardRunnerFailureLayer = (message: string): Layer.Layer<StewardRunner> =>
  Layer.succeed(
    StewardRunner,
    StewardRunner.of({
      name: "pi-process",
      run: Effect.fnUntraced(function* (_request: StewardRunnerRequest) {
        return yield* new StewardRunnerError({ message });
      }),
    }),
  );

export const scriptedStewardRunnerLayer = (
  responses: ReadonlyArray<Effect.Effect<StewardResultValue, StewardRunnerError>>,
): Layer.Layer<StewardRunner> =>
  Layer.effect(
    StewardRunner,
    Effect.gen(function* () {
      const indexRef = yield* Ref.make(0);
      const run = Effect.fnUntraced(function* () {
        const index = yield* Ref.getAndUpdate(indexRef, (value) => value + 1);
        const response = responses.at(index) ?? responses.at(responses.length - 1);
        if (response === undefined) {
          return yield* new StewardRunnerError({ message: "No scripted steward runner response" });
        }
        return yield* response;
      });

      return StewardRunner.of({ name: "pi-process", run });
    }),
  );
