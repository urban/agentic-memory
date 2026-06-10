import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { STEWARD_TOOLS } from "../constants.ts";
import {
  decodeCaptureResultEnvelopeJson,
  decodeScratchpadOption,
  encodeCapturePayloadJson,
  type CapturePayload,
  type CaptureResultStatus,
  type Scratchpad,
} from "../schema.ts";
import { buildCapturePrompt } from "../text.ts";
import { Config } from "./Config.ts";

export interface StewardRunResult {
  readonly status: CaptureResultStatus;
  readonly summary: string;
  readonly filesChanged: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly scratchpad: Scratchpad | undefined;
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

export class MemorySteward extends Context.Service<
  MemorySteward,
  {
    readonly run: (input: {
      readonly vaultPath: string;
      readonly payload: CapturePayload;
      readonly payloadWarnings: ReadonlyArray<string>;
      readonly timeoutMillis: number;
    }) => Effect.Effect<StewardRunResult, MemoryStewardError>;
  }
>()("@urban/pi-memory-capture/services/MemorySteward") {
  static readonly layer = Layer.effect(
    MemorySteward,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* StewardExecutor;
      const config = yield* Config;
      const { piBinary } = yield* config.environmentOverrides;

      const run = Effect.fn("MemorySteward.run")(function* (input: {
        readonly vaultPath: string;
        readonly payload: CapturePayload;
        readonly payloadWarnings: ReadonlyArray<string>;
        readonly timeoutMillis: number;
      }): Effect.fn.Return<StewardRunResult, MemoryStewardError> {
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
                "--tools",
                STEWARD_TOOLS,
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
                message: `Memory Steward process timed out after ${timeoutMillis}ms`,
                cause: result,
              });
            }

            if (result.code !== 0) {
              return yield* new MemoryStewardError({
                message: `Memory Steward exited with code ${result.code}`,
                cause: {
                  stderr: result.stderr,
                  stdout: result.stdout,
                },
              });
            }

            const assistantText = extractAssistantText(result.stdout);
            if (assistantText.trim().length === 0) {
              return yield* new MemoryStewardError({
                message: "Memory Steward did not emit a final assistant JSON message",
                cause: {
                  stderr: result.stderr,
                  stdout: result.stdout,
                },
              });
            }

            const envelope = yield* decodeCaptureResultEnvelopeJson(assistantText).pipe(
              Effect.mapError(
                (cause) =>
                  new MemoryStewardError({
                    message: "Memory Steward returned invalid Capture Result JSON",
                    cause,
                  }),
              ),
            );

            const scratchpadResult =
              envelope.scratchpad === undefined
                ? {
                    scratchpad: undefined,
                    warnings: [],
                  }
                : Option.match(decodeScratchpadOption(envelope.scratchpad), {
                    onNone: () => ({
                      scratchpad: undefined,
                      warnings: [
                        "Memory Steward returned an invalid scratchpad; the previous local scratchpad was kept.",
                      ],
                    }),
                    onSome: (scratchpad) => ({
                      scratchpad,
                      warnings: [],
                    }),
                  });

            return {
              status: envelope.status,
              summary: envelope.summary,
              filesChanged: envelope.filesChanged ?? [],
              warnings: [...(envelope.warnings ?? []), ...scratchpadResult.warnings],
              scratchpad: scratchpadResult.scratchpad,
            };
          }),
        );
      });

      return MemorySteward.of({
        run,
      });
    }),
  );
}
