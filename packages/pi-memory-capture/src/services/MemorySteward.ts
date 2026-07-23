import { Cause, Context, Duration, Effect, FileSystem, Layer, Schema } from "effect";
import { encodeCapturePayloadJson } from "@urban/agentic-memory-core/capture/CapturePayload";
import {
  decodeRunStewardResultJson,
  encodeStewardDurationSync,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import { CaptureConfig } from "./CaptureConfig.ts";

type ExecOptions = import("@earendil-works/pi-coding-agent").ExecOptions;
type ExecResult = import("@earendil-works/pi-coding-agent").ExecResult;
type StewardSessionPointer =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardSessionPointer;
type StewardDecisionReport =
  import("@urban/agentic-memory-core/steward/StewardResult").StewardDecisionReport;
type CapturePayload = import("@urban/agentic-memory-core/capture/CapturePayload").CapturePayload;
type CaptureAttemptId =
  import("@urban/agentic-memory-core/observability/CaptureTelemetry").CaptureAttemptId;
type CaptureRunId =
  import("@urban/agentic-memory-core/observability/CaptureTelemetry").CaptureRunId;
type StewardResultStatus =
  import("@urban/agentic-memory-core/steward/StewardResult").StewardResultStatus;
type CaptureTriggerKind =
  import("@urban/agentic-memory-core/observability/CaptureTelemetry").CaptureTriggerKind;
type StewardDuration =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardDuration;

const MAX_EXECUTOR_TIMEOUT_MILLIS = 2_147_483_647;

export interface StewardObservationResult {
  readonly status: StewardResultStatus;
  readonly summary: string | undefined;
  readonly filesChanged: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly decisionReport: StewardDecisionReport;
  readonly stewardSession?: StewardSessionPointer;
}

export type StewardRunResult =
  | {
      readonly _tag: "Succeeded";
      readonly result: StewardObservationResult;
      readonly retryFailureReasons: ReadonlyArray<string>;
      readonly stewardSession?: StewardSessionPointer;
    }
  | {
      readonly _tag: "Failed";
      readonly retryFailureReasons: ReadonlyArray<string>;
      readonly stewardSession?: StewardSessionPointer;
    };

export class MemoryStewardError extends Schema.TaggedErrorClass<MemoryStewardError>()(
  "MemoryStewardError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class StewardExecutor extends Context.Service<
  StewardExecutor,
  {
    readonly exec: (
      command: string,
      args: ReadonlyArray<string>,
      options: ExecOptions | undefined,
    ) => Effect.Effect<ExecResult, MemoryStewardError>;
  }
>()("@urban/pi-memory-capture/services/MemorySteward/StewardExecutor") {}

const normalizeFailureReason = (message: string): string => {
  const baseWords = message
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);
  const paddedWords = [
    ...baseWords,
    "during",
    "agentic-memory",
    "CLI",
    "capture",
    "send",
    "attempt",
  ];
  return paddedWords.slice(0, 15).join(" ");
};

export const stewardExecutorTimeoutMillis = (
  timeout: StewardDuration,
): Effect.Effect<number, MemoryStewardError> => {
  const timeoutMillis = Duration.toMillis(Duration.sum(timeout, Duration.seconds(5)));
  return Number.isFinite(timeoutMillis) &&
    timeoutMillis > 0 &&
    timeoutMillis <= MAX_EXECUTOR_TIMEOUT_MILLIS
    ? Effect.succeed(timeoutMillis)
    : Effect.fail(
        new MemoryStewardError({
          message: "Memory Steward outer timeout exceeds the executor timer ceiling",
        }),
      );
};

export class MemorySteward extends Context.Service<
  MemorySteward,
  {
    readonly run: (input: {
      readonly projectRoot: string;
      readonly payload: CapturePayload;
      readonly payloadWarnings: ReadonlyArray<string>;
      readonly timeout: StewardDuration;
      readonly captureRunId: CaptureRunId;
      readonly attemptId: CaptureAttemptId;
      readonly triggerKind: CaptureTriggerKind;
    }) => Effect.Effect<StewardRunResult>;
  }
>()("@urban/pi-memory-capture/services/MemorySteward") {
  static readonly layer = Layer.effect(
    MemorySteward,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* StewardExecutor;
      const config = yield* CaptureConfig;
      const { cliBinary } = yield* config.environmentOverrides;

      const run = Effect.fn("MemorySteward.run")(function* (input: {
        readonly projectRoot: string;
        readonly payload: CapturePayload;
        readonly payloadWarnings: ReadonlyArray<string>;
        readonly timeout: StewardDuration;
        readonly captureRunId: CaptureRunId;
        readonly attemptId: CaptureAttemptId;
        readonly triggerKind: CaptureTriggerKind;
      }): Effect.fn.Return<StewardRunResult> {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const signal = yield* Effect.abortSignal;
            const payloadJson = yield* encodeCapturePayloadJson(input.payload).pipe(
              Effect.mapError(
                (cause) =>
                  new MemoryStewardError({
                    message: "Failed to encode Capture Payload JSON",
                    cause,
                  }),
              ),
            );
            const payloadPath = yield* Effect.acquireRelease(
              fs.makeTempFile({ prefix: "agentic-memory-payload-", suffix: ".json" }).pipe(
                Effect.mapError(
                  (cause) =>
                    new MemoryStewardError({
                      message: "Failed to create temporary capture payload file",
                      cause,
                    }),
                ),
              ),
              (path) => fs.remove(path, { force: true }).pipe(Effect.ignore),
            );
            yield* fs.writeFileString(payloadPath, payloadJson).pipe(
              Effect.mapError(
                (cause) =>
                  new MemoryStewardError({
                    message: `Failed to write temporary capture payload file: ${payloadPath}`,
                    cause,
                  }),
              ),
            );
            const executorTimeoutMillis = yield* stewardExecutorTimeoutMillis(input.timeout);
            return yield* executor.exec(
              cliBinary ?? "agentic-memory",
              [
                "-C",
                input.projectRoot,
                "run-steward",
                "--payload",
                payloadPath,
                "--json",
                "--timeout",
                encodeStewardDurationSync(input.timeout),
                "--capture-attempt-id",
                input.attemptId,
                "--capture-run-id",
                input.captureRunId,
                "--capture-trigger-kind",
                input.triggerKind,
              ],
              {
                cwd: input.projectRoot,
                signal,
                timeout: executorTimeoutMillis,
              },
            );
          }),
        ).pipe(Effect.exit);

        if (result._tag === "Failure") {
          if (result.cause.reasons.some(Cause.isInterruptReason)) {
            return yield* Effect.interrupt;
          }

          return {
            _tag: "Failed",
            retryFailureReasons: [normalizeFailureReason("Failed to execute agentic-memory CLI")],
          };
        }

        const decoded = yield* decodeRunStewardResultJson(result.value.stdout.trim()).pipe(
          Effect.exit,
        );
        if (decoded._tag === "Failure") {
          return {
            _tag: "Failed",
            retryFailureReasons: [normalizeFailureReason("Invalid JSON from agentic-memory CLI")],
          };
        }

        if (decoded.value.status === "failed") {
          return {
            _tag: "Failed",
            retryFailureReasons: decoded.value.retryFailureReasons,
            ...(decoded.value.stewardSession === undefined
              ? {}
              : { stewardSession: decoded.value.stewardSession }),
          };
        }

        if (result.value.killed || result.value.code !== 0) {
          return {
            _tag: "Failed",
            retryFailureReasons: [
              normalizeFailureReason("agentic-memory CLI exited unsuccessfully"),
            ],
            ...(decoded.value.stewardSession === undefined
              ? {}
              : { stewardSession: decoded.value.stewardSession }),
          };
        }

        return {
          _tag: "Succeeded",
          result: {
            status: decoded.value.result.status,
            summary: decoded.value.result.summary,
            filesChanged: decoded.value.result.filesChanged,
            warnings: decoded.value.result.warnings,
            decisionReport: decoded.value.result.decisionReport,
            ...(decoded.value.stewardSession === undefined
              ? {}
              : { stewardSession: decoded.value.stewardSession }),
          },
          retryFailureReasons: decoded.value.retryFailureReasons,
          ...(decoded.value.stewardSession === undefined
            ? {}
            : { stewardSession: decoded.value.stewardSession }),
        };
      });

      return MemorySteward.of({
        run,
      });
    }),
  );
}
