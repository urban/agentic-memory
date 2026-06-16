import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type { StewardSessionPointer } from "@urban/agentic-memory-core/steward/StewardExecution";
import type { StewardDecisionReport } from "@urban/agentic-memory-core/steward/StewardResult";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import { encodeCapturePayloadJson, type CapturePayload } from "../schema.ts";
import {
  decodeRunStewardResultJson,
  type AttemptId,
  type StewardResultStatus,
  type TriggerKind,
} from "../schema.ts";
import { CaptureConfig } from "./CaptureConfig.ts";

export interface StewardObservationResult {
  readonly status: StewardResultStatus;
  readonly summary: string | undefined;
  readonly filesChanged: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly decisionReport?: StewardDecisionReport;
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

export class MemorySteward extends Context.Service<
  MemorySteward,
  {
    readonly run: (input: {
      readonly projectRoot: string;
      readonly payload: CapturePayload;
      readonly payloadWarnings: ReadonlyArray<string>;
      readonly timeoutMillis: number;
      readonly captureRunId: string;
      readonly attemptId: AttemptId;
      readonly triggerKind: TriggerKind;
      readonly projectSlug: string;
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
        readonly timeoutMillis: number;
        readonly captureRunId: string;
        readonly attemptId: AttemptId;
        readonly triggerKind: TriggerKind;
        readonly projectSlug: string;
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
              (path) => fs.remove(path, { force: true }).pipe(Effect.catch(() => Effect.void)),
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
            return yield* executor.exec(
              cliBinary ?? "agentic-memory",
              [
                "run-steward",
                "--payload",
                payloadPath,
                "--project-root",
                input.projectRoot,
                "--json",
                "--timeout-ms",
                String(input.timeoutMillis),
                "--capture-attempt-id",
                input.attemptId,
                "--capture-run-id",
                input.captureRunId,
                "--capture-trigger-kind",
                input.triggerKind,
                "--capture-project-slug",
                input.projectSlug,
              ],
              {
                cwd: input.projectRoot,
                signal,
                timeout: input.timeoutMillis + 5_000,
              },
            );
          }),
        ).pipe(Effect.exit);

        if (result._tag === "Failure") {
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
            ...(decoded.value.result.decisionReport === undefined
              ? {}
              : { decisionReport: decoded.value.result.decisionReport }),
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
