import { Cause, Context, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import { captureCorrelationAttributes } from "../observability/CaptureTelemetry.ts";
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
  attempts: Schema.Number,
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

export interface StewardRunOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly timeoutMillis?: number;
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

const decisionReportAttributes = (result: StewardResultValue): Record<string, unknown> => ({
  "capture.decision.durability": result.decisionReport.durability,
  "capture.decision.selected_count": result.decisionReport.selectedDestinations.length,
  "capture.decision.skipped_count": result.decisionReport.skippedDestinations.length,
  "capture.decision.summary": result.decisionReport.decisionSummary,
});

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
    ...captureCorrelationAttributes(input.correlation),
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
        ...decisionReportAttributes(result.value.result),
        ...(stewardSession === undefined
          ? {}
          : {
              "capture.steward.session_id": stewardSession.sessionId,
              "capture.steward.session_name": stewardSession.name,
              "capture.steward.session_cwd": stewardSession.cwd,
              "capture.steward.session_started_at": stewardSession.startedAt,
            }),
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
    ...(latestStewardSession === undefined
      ? {}
      : {
          "capture.steward.session_id": latestStewardSession.sessionId,
          "capture.steward.session_name": latestStewardSession.name,
          "capture.steward.session_cwd": latestStewardSession.cwd,
          "capture.steward.session_started_at": latestStewardSession.startedAt,
        }),
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
