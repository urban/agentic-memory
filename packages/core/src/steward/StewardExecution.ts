import {
  Cause,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import {
  captureDecisionReportAttributes,
  captureStewardSessionAttributes,
  captureTelemetryContextAttributes,
} from "../observability/CaptureTelemetry.ts";
import { buildStewardContext, StewardContextError } from "./StewardContext.ts";
import { StewardResult } from "./StewardResult.ts";

type CaptureCorrelation = import("../observability/CaptureTelemetry.ts").CaptureCorrelation;
type CapturePayload = import("../capture/CapturePayload.ts").CapturePayload;
type ProjectSlug = import("../link/ProjectSlug.ts").ProjectSlug;
type StewardContextResult = import("./StewardContext.ts").StewardContextResult;
type StewardResultValue = import("./StewardResult.ts").StewardResult;

export const RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MILLIS = [1_000, 2_000];

export const StewardRunnerName = Schema.Literal("pi-process").annotate({
  identifier: "StewardRunnerName",
});
export type StewardRunnerName = typeof StewardRunnerName.Type;

export const StewardExecutionInfo = Schema.Struct({
  runner: StewardRunnerName,
  attempts: Schema.Finite,
}).annotate({ identifier: "StewardExecutionInfo" });
export type StewardExecutionInfo = typeof StewardExecutionInfo.Type;

export const StewardSessionPointer = Schema.Struct({
  sessionId: Schema.String,
  name: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.String,
}).annotate({ identifier: "StewardSessionPointer" });
export type StewardSessionPointer = typeof StewardSessionPointer.Type;

export const RunStewardResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("succeeded"),
    result: StewardResult,
    execution: StewardExecutionInfo,
    retryFailureReasons: Schema.Array(Schema.String),
    warnings: Schema.Array(Schema.String),
    stewardSession: Schema.optional(StewardSessionPointer),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    execution: StewardExecutionInfo,
    retryFailureReasons: Schema.Array(Schema.String),
    warnings: Schema.Array(Schema.String),
    stewardSession: Schema.optional(StewardSessionPointer),
  }),
]).annotate({ identifier: "RunStewardResult" });
export type RunStewardResult = typeof RunStewardResult.Type;

export const RunStewardResultJson = Schema.fromJsonString(RunStewardResult).annotate({
  identifier: "RunStewardResultJson",
});
export const encodeRunStewardResultJson = Schema.encodeUnknownEffect(RunStewardResultJson);
export const decodeRunStewardResultJson = Schema.decodeUnknownEffect(RunStewardResultJson);

const StewardSelector = Schema.String.check(
  Schema.isPattern(/\S/, {
    message: "Expected a selector containing non-whitespace content",
  }),
);

export const StewardProvider = StewardSelector.pipe(Schema.brand("StewardProvider")).annotate({
  identifier: "StewardProvider",
});
export type StewardProvider = typeof StewardProvider.Type;

export const StewardModel = StewardSelector.pipe(Schema.brand("StewardModel")).annotate({
  identifier: "StewardModel",
});
export type StewardModel = typeof StewardModel.Type;

export const StewardThinkingLevel = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]).annotate({ identifier: "StewardThinkingLevel" });
export type StewardThinkingLevel = typeof StewardThinkingLevel.Type;

// Leaves the Pi capture executor's five-second outer margin within Node's timer ceiling.
export const MAX_STEWARD_TIMEOUT_MILLIS = 2_147_478_647;

const maximumStewardTimeoutNanos = BigInt(MAX_STEWARD_TIMEOUT_MILLIS) * 1_000_000n;

const durationUnitNanos = (unit: string): Option.Option<bigint> => {
  switch (unit) {
    case "ms":
    case "milli":
    case "millis":
      return Option.some(1_000_000n);
    case "s":
    case "second":
    case "seconds":
      return Option.some(1_000_000_000n);
    case "m":
    case "minute":
    case "minutes":
      return Option.some(60_000_000_000n);
    case "h":
    case "hour":
    case "hours":
      return Option.some(3_600_000_000_000n);
    case "d":
    case "day":
    case "days":
      return Option.some(86_400_000_000_000n);
    case "w":
    case "week":
    case "weeks":
      return Option.some(604_800_000_000_000n);
    default:
      return Option.none();
  }
};

const isWithinMaximumStewardTimeout = (value: string, nanosPerUnit: bigint): boolean => {
  if (value.startsWith("-")) {
    return true;
  }

  const unsignedValue = value.startsWith("+") ? value.slice(1) : value;
  const decimalIndex = unsignedValue.indexOf(".");
  const whole = decimalIndex === -1 ? unsignedValue : unsignedValue.slice(0, decimalIndex);
  const fraction = decimalIndex === -1 ? "" : unsignedValue.slice(decimalIndex + 1);
  const significand = BigInt(`${whole === "" ? "0" : whole}${fraction}`);
  const decimalScale = 10n ** BigInt(fraction.length);

  return significand * nanosPerUnit <= maximumStewardTimeoutNanos * decimalScale;
};

const StewardDurationValue = Schema.Duration.check(
  Schema.makeFilter(
    (duration) => {
      switch (duration.value._tag) {
        case "Millis":
          return (
            Number.isFinite(duration.value.millis) &&
            duration.value.millis > 0 &&
            duration.value.millis <= MAX_STEWARD_TIMEOUT_MILLIS
          );
        case "Nanos":
          return duration.value.nanos > 0n && duration.value.nanos <= maximumStewardTimeoutNanos;
        case "Infinity":
        case "NegativeInfinity":
          return false;
      }
    },
    { expected: "a positive finite duration representable in milliseconds" },
  ),
)
  .pipe(Schema.brand("StewardDuration"))
  .annotate({ identifier: "StewardDurationValue" });

const stewardDurationFromString = SchemaTransformation.transformOrFail<Duration.Duration, string>({
  decode: (input) => {
    const nanosMatch = Option.fromNullOr(/^([+-]?\d+)\s*(ns|nano|nanos)$/.exec(input));
    if (Option.isSome(nanosMatch)) {
      return Effect.succeed(Duration.nanos(BigInt(nanosMatch.value[1])));
    }

    const match = Option.fromNullOr(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(ms|s|m|h|d|w|milli|millis|second|seconds|minute|minutes|hour|hours|day|days|week|weeks)$/.exec(
        input,
      ),
    );
    if (Option.isNone(match)) {
      return Effect.fail(
        new SchemaIssue.InvalidValue(Option.some(input), {
          message: `Invalid Steward duration string: ${input}`,
        }),
      );
    }
    const valueToken = match.value[1];
    const unit = match.value[2];
    const nanosPerUnit = durationUnitNanos(unit);
    if (
      Option.isNone(nanosPerUnit) ||
      !isWithinMaximumStewardTimeout(valueToken, nanosPerUnit.value)
    ) {
      return Effect.fail(
        new SchemaIssue.InvalidValue(Option.some(input), {
          message: `Invalid Steward duration string: ${input}`,
        }),
      );
    }

    const value = Number(valueToken);
    switch (unit) {
      case "ms":
      case "milli":
      case "millis":
        return Effect.succeed(Duration.millis(value));
      case "s":
      case "second":
      case "seconds":
        return Effect.succeed(Duration.seconds(value));
      case "m":
      case "minute":
      case "minutes":
        return Effect.succeed(Duration.minutes(value));
      case "h":
      case "hour":
      case "hours":
        return Effect.succeed(Duration.hours(value));
      case "d":
      case "day":
      case "days":
        return Effect.succeed(Duration.days(value));
      case "w":
      case "week":
      case "weeks":
        return Effect.succeed(Duration.weeks(value));
      default:
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(input), {
            message: `Invalid Steward duration string: ${input}`,
          }),
        );
    }
  },
  encode: (duration) => Effect.succeed(String(duration)),
});

export const StewardDuration = Schema.String.pipe(
  Schema.decodeTo(StewardDurationValue, stewardDurationFromString),
).annotate({ identifier: "StewardDuration" });
export type StewardDuration = typeof StewardDuration.Type;

export const decodeStewardProvider = Schema.decodeUnknownEffect(StewardProvider);
export const decodeStewardModel = Schema.decodeUnknownEffect(StewardModel);
export const decodeStewardThinkingLevel = Schema.decodeUnknownEffect(StewardThinkingLevel);
export const decodeStewardDuration = Schema.decodeUnknownEffect(StewardDuration);
export const decodeStewardDurationSync = Schema.decodeUnknownSync(StewardDuration);
export const encodeStewardDurationSync = Schema.encodeSync(StewardDuration);

export interface StewardRunOptions {
  readonly provider?: StewardProvider;
  readonly model?: StewardModel;
  readonly thinking?: StewardThinkingLevel;
  readonly timeout?: StewardDuration;
}

export interface StewardRunnerRequest {
  readonly context: StewardContextResult;
  readonly options: StewardRunOptions;
  readonly correlation?: CaptureCorrelation;
}

export interface StewardRunnerOutcome {
  readonly result: StewardResultValue;
  readonly stewardSession?: StewardSessionPointer;
}

export class StewardRunnerError extends Schema.TaggedErrorClass<StewardRunnerError>()(
  "StewardRunnerError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
    stewardSession: Schema.optional(StewardSessionPointer),
  },
) {}

export class StewardRunner extends Context.Service<
  StewardRunner,
  {
    readonly name: StewardRunnerName;
    readonly run: (
      request: StewardRunnerRequest,
    ) => Effect.Effect<StewardRunnerOutcome, StewardRunnerError>;
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

const stewardSessionFromCause = (
  cause: Cause.Cause<StewardRunnerError>,
): StewardSessionPointer | undefined => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason) && reason.error.stewardSession !== undefined) {
      return reason.error.stewardSession;
    }
  }
  return undefined;
};

const withOptionalStewardSession = <T extends object>(
  value: T,
  stewardSession: StewardSessionPointer | undefined,
): T | (T & { readonly stewardSession: StewardSessionPointer }) =>
  stewardSession === undefined ? value : { ...value, stewardSession };

export const runSteward = Effect.fn("agentic-memory.run_steward")(function* (input: {
  readonly payload: CapturePayload;
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
  readonly payloadWarnings: ReadonlyArray<string>;
  readonly options: StewardRunOptions;
  readonly correlation?: CaptureCorrelation;
}): Effect.fn.Return<
  RunStewardResult,
  StewardContextError,
  FileSystem.FileSystem | Path.Path | StewardRunner
> {
  const runner = yield* StewardRunner;
  const baseAttributes = {
    ...captureTelemetryContextAttributes(input.projectSlug, input.correlation),
    "capture.payload.warning_count": input.payloadWarnings.length,
  };
  yield* Effect.annotateCurrentSpan(baseAttributes);

  const context = yield* buildStewardContext({
    payload: input.payload,
    vaultPath: input.vaultPath,
    projectSlug: input.projectSlug,
    payloadWarnings: input.payloadWarnings,
  }).pipe(Effect.withSpan("steward.build_context"), Effect.annotateSpans(baseAttributes));

  const retryFailureReasons: string[] = [];
  let attemptIndex = 0;
  let latestStewardSession: StewardSessionPointer | undefined;

  while (attemptIndex < RETRY_ATTEMPTS) {
    const runnerAttributes = {
      ...baseAttributes,
      "capture.steward.retry_count": attemptIndex,
    };
    const result = yield* runner
      .run({
        context,
        options: input.options,
        ...(input.correlation === undefined ? {} : { correlation: input.correlation }),
      })
      .pipe(
        Effect.withSpan("steward.invoke_pi_process", { attributes: runnerAttributes }),
        Effect.exit,
      );
    if (result._tag === "Success") {
      const stewardSession = result.value.stewardSession ?? latestStewardSession;
      const successAttributes = {
        ...runnerAttributes,
        ...captureDecisionReportAttributes(result.value.result.decisionReport),
        ...captureStewardSessionAttributes(stewardSession),
        "capture.steward.status": result.value.result.status,
        "capture.changed_files_count": result.value.result.filesChanged.length,
      };
      yield* Effect.annotateCurrentSpan(successAttributes);
      yield* Effect.logInfo("Memory Steward completed").pipe(
        Effect.annotateLogs(successAttributes),
      );

      return withOptionalStewardSession(
        {
          status: "succeeded",
          result: result.value.result,
          execution: {
            runner: runner.name,
            attempts: attemptIndex + 1,
          },
          retryFailureReasons,
          warnings: [...input.payloadWarnings, ...result.value.result.warnings],
        },
        stewardSession,
      );
    }

    latestStewardSession = stewardSessionFromCause(result.cause) ?? latestStewardSession;
    retryFailureReasons.push(normalizeRetryFailureReason(Cause.pretty(result.cause)));
    attemptIndex += 1;
    yield* Effect.logWarning("Memory Steward retry failed").pipe(
      Effect.annotateLogs({
        ...baseAttributes,
        "capture.steward.retry_count": attemptIndex,
      }),
    );
    if (attemptIndex < RETRY_ATTEMPTS) {
      yield* Effect.sleep(backoffForAttemptIndex(attemptIndex));
    }
  }

  const failedAttributes = {
    ...baseAttributes,
    ...captureStewardSessionAttributes(latestStewardSession),
    "capture.steward.status": "failed",
    "capture.steward.retry_count": RETRY_ATTEMPTS,
  };
  yield* Effect.annotateCurrentSpan(failedAttributes);
  yield* Effect.logError("Memory Steward failed after retries").pipe(
    Effect.annotateLogs(failedAttributes),
  );

  return withOptionalStewardSession(
    {
      status: "failed",
      execution: {
        runner: runner.name,
        attempts: RETRY_ATTEMPTS,
      },
      retryFailureReasons,
      warnings: [...input.payloadWarnings],
    },
    latestStewardSession,
  );
});

export const stewardRunnerSuccessLayer = (result: StewardResultValue): Layer.Layer<StewardRunner> =>
  Layer.succeed(
    StewardRunner,
    StewardRunner.of({
      name: "pi-process",
      run: (_request: StewardRunnerRequest) => Effect.succeed({ result }),
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
  responses: ReadonlyArray<Effect.Effect<StewardRunnerOutcome, StewardRunnerError>>,
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
