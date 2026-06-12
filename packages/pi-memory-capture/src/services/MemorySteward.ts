import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { Cause, Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { RETRY_ATTEMPTS, RETRY_BACKOFF_MILLIS } from "../constants.ts";
import {
  decodeStewardResultEnvelopeJson,
  encodeCapturePayloadJson,
  type CapturePayload,
  type StewardResultStatus,
} from "../schema.ts";
import { buildCapturePrompt } from "../text.ts";
import { CaptureConfig } from "./CaptureConfig.ts";

export interface StewardObservationResult {
  readonly status: StewardResultStatus;
  readonly summary: string | undefined;
  readonly filesChanged: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export type StewardRunResult =
  | {
      readonly _tag: "Succeeded";
      readonly result: StewardObservationResult;
      readonly retryFailureReasons: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Failed";
      readonly retryFailureReasons: ReadonlyArray<string>;
    };

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
}).annotate({
  identifier: "AssistantMessageEndEvent",
});

const decodeAssistantMessageEndEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(AssistantMessageEndEvent),
);

type AssistantMessageEndEvent = typeof AssistantMessageEndEvent.Type;

const assistantTextFromEvent = (event: AssistantMessageEndEvent): string =>
  event.message.content
    .filter(
      (
        block,
      ): block is {
        readonly type: string;
        readonly text: string;
      } => block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
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
    "isolated",
    "Memory",
    "Steward",
    "capture",
    "send",
    "attempt",
    "cycle",
    "today",
    "now",
  ];
  return paddedWords.slice(0, 15).join(" ");
};

const backoffForAttemptIndex = (attemptIndex: number): number =>
  RETRY_BACKOFF_MILLIS[attemptIndex - 1] ?? 0;

export class MemorySteward extends Context.Service<
  MemorySteward,
  {
    readonly run: (input: {
      readonly vaultPath: string;
      readonly payload: CapturePayload;
      readonly payloadWarnings: ReadonlyArray<string>;
      readonly timeoutMillis: number;
    }) => Effect.Effect<StewardRunResult>;
  }
>()("@urban/pi-memory-capture/services/MemorySteward") {
  static readonly layer = Layer.effect(
    MemorySteward,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* StewardExecutor;
      const config = yield* CaptureConfig;
      const { piBinary } = yield* config.environmentOverrides;

      const runOnce = Effect.fn("MemorySteward.runOnce")(function* (input: {
        readonly vaultPath: string;
        readonly payload: CapturePayload;
        readonly payloadWarnings: ReadonlyArray<string>;
        readonly timeoutMillis: number;
      }): Effect.fn.Return<StewardObservationResult, MemoryStewardError> {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const { vaultPath, payload, payloadWarnings, timeoutMillis } = input;
            const signal = yield* Effect.abortSignal;
            const appendSystemPromptPath = `${vaultPath}/.agentic-memory/LLM-outside-vault.md`;
            const appendSystemPrompt = yield* fs.readFileString(appendSystemPromptPath).pipe(
              Effect.mapError(
                (cause) =>
                  new MemoryStewardError({
                    message: `Failed to read Memory Steward contract: ${appendSystemPromptPath}`,
                    cause,
                  }),
              ),
            );
            const payloadJson = yield* encodeCapturePayloadJson(payload).pipe(
              Effect.mapError(
                (cause) =>
                  new MemoryStewardError({
                    message: "Failed to encode Capture Payload JSON",
                    cause,
                  }),
              ),
            );
            const prompt = buildCapturePrompt(payloadJson, payloadWarnings);
            const result = yield* executor.exec(
              piBinary ?? "pi",
              [
                "--mode",
                "json",
                "--no-session",
                "--no-context-files",
                "--no-extensions",
                "--no-skills",
                "--append-system-prompt",
                appendSystemPrompt,
                "-p",
                prompt,
              ],
              {
                cwd: vaultPath,
                signal,
                timeout: timeoutMillis,
              },
            );

            if (result.killed) {
              return yield* new MemoryStewardError({
                message: `Timed out waiting for steward final JSON after child process launch`,
                cause: result,
              });
            }

            if (result.code !== 0) {
              return yield* new MemoryStewardError({
                message: `Steward process exited with non-zero status before emitting final JSON`,
                cause: {
                  stderr: result.stderr,
                  stdout: result.stdout,
                },
              });
            }

            const assistantText = extractAssistantText(result.stdout);
            if (assistantText.trim().length === 0) {
              return yield* new MemoryStewardError({
                message: "Steward returned EOF before final assistant JSON response was emitted",
                cause: {
                  stderr: result.stderr,
                  stdout: result.stdout,
                },
              });
            }

            const envelope = yield* decodeStewardResultEnvelopeJson(assistantText).pipe(
              Effect.mapError(
                (cause) =>
                  new MemoryStewardError({
                    message: "Steward returned invalid final JSON for capture result schema",
                    cause,
                  }),
              ),
            );

            return {
              status: envelope.status,
              summary: envelope.summary,
              filesChanged: envelope.filesChanged ?? [],
              warnings: envelope.warnings ?? [],
            };
          }),
        );
      });

      const runWithRetries = Effect.fn("MemorySteward.runWithRetries")(function* (input: {
        readonly vaultPath: string;
        readonly payload: CapturePayload;
        readonly payloadWarnings: ReadonlyArray<string>;
        readonly timeoutMillis: number;
      }): Effect.fn.Return<StewardRunResult> {
        const retryFailureReasons: string[] = [];
        let attemptIndex = 0;

        while (attemptIndex < RETRY_ATTEMPTS) {
          const result = yield* runOnce(input).pipe(Effect.exit);
          if (result._tag === "Success") {
            return {
              _tag: "Succeeded",
              result: result.value,
              retryFailureReasons,
            };
          }

          retryFailureReasons.push(normalizeFailureReason(Cause.pretty(result.cause)));
          attemptIndex += 1;
          if (attemptIndex < RETRY_ATTEMPTS) {
            yield* Effect.sleep(backoffForAttemptIndex(attemptIndex));
          }
        }

        return {
          _tag: "Failed",
          retryFailureReasons,
        };
      });

      return MemorySteward.of({
        run: runWithRetries,
      });
    }),
  );
}
