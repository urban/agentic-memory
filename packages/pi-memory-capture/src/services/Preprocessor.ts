import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import { MESSAGE_LIMIT, PAYLOAD_CHAR_LIMIT } from "../constants.ts";
import { projectLabelFromLink } from "../project.ts";
import {
  type CaptureCheckpoint,
  type CapturePayload,
  type PayloadMessage,
  type Scratchpad,
} from "../schema.ts";
import { clipSummary, sanitizeVisibleText, truncateMessageText } from "../text.ts";

type UserVisibleBlock = TextContent | ImageContent;
type AssistantVisibleBlock = TextContent | ThinkingContent | ToolCall;

export type BuildPayloadResult =
  | {
      readonly _tag: "NoMessages";
      readonly warnings: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Payload";
      readonly payload: CapturePayload;
      readonly warnings: ReadonlyArray<string>;
    };

const isUserMessage = (message: SessionMessageEntry["message"]): message is UserMessage =>
  message.role === "user";

const isAssistantMessage = (message: SessionMessageEntry["message"]): message is AssistantMessage =>
  message.role === "assistant";

const isTextBlock = (value: UserVisibleBlock | AssistantVisibleBlock): value is TextContent =>
  value.type === "text";

const extractUserText = (message: UserMessage) => {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n\n");
};

const extractAssistantText = (message: AssistantMessage) =>
  message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n\n");

const toPayloadMessage = (entry: SessionMessageEntry): PayloadMessage | undefined => {
  if (isUserMessage(entry.message)) {
    const sanitized = sanitizeVisibleText(extractUserText(entry.message));
    if (sanitized.length === 0) {
      return undefined;
    }

    const truncated = truncateMessageText(sanitized);
    return {
      entryId: entry.id,
      role: "user",
      text: truncated.text,
      truncated: truncated.truncated,
    };
  }

  if (!isAssistantMessage(entry.message)) {
    return undefined;
  }

  const extracted = extractAssistantText(entry.message);
  const sanitized = sanitizeVisibleText(extracted);
  if (sanitized.length === 0) {
    return undefined;
  }

  const truncated = truncateMessageText(sanitized);
  return {
    entryId: entry.id,
    role: "assistant",
    text: truncated.text,
    truncated: truncated.truncated,
  };
};

export class Preprocessor extends Context.Service<
  Preprocessor,
  {
    readonly buildPayload: (
      checkpoint: CaptureCheckpoint,
      projectLink: string,
      observedEntries: ReadonlyArray<SessionEntry>,
      scratchpad: Scratchpad,
    ) => Effect.Effect<BuildPayloadResult>;
  }
>()("@urban/pi-memory-capture/services/Preprocessor") {
  static readonly layer = Layer.succeed(
    Preprocessor,
    Preprocessor.of({
      buildPayload: Effect.fn("Preprocessor.buildPayload")(
        (checkpoint, projectLink, observedEntries, scratchpad) =>
          Effect.succeed(
            (() => {
              const messages: PayloadMessage[] = [];
              const warnings: string[] = [];
              let payloadChars = 0;

              for (const entry of observedEntries) {
                if (
                  entry.type !== "message" ||
                  (entry.message.role !== "user" && entry.message.role !== "assistant")
                ) {
                  continue;
                }

                const payloadMessage = toPayloadMessage(entry);
                if (payloadMessage === undefined) {
                  continue;
                }

                if (messages.length >= MESSAGE_LIMIT) {
                  warnings.push(
                    `Message count reached ${MESSAGE_LIMIT}; later messages were omitted.`,
                  );
                  break;
                }

                if (payloadChars + payloadMessage.text.length > PAYLOAD_CHAR_LIMIT) {
                  warnings.push(
                    `Payload text reached ${PAYLOAD_CHAR_LIMIT} characters; later messages were omitted.`,
                  );
                  break;
                }

                messages.push(payloadMessage);
                payloadChars += payloadMessage.text.length;
              }

              if (messages.length === 0) {
                return {
                  _tag: "NoMessages",
                  warnings,
                } satisfies BuildPayloadResult;
              }

              const firstObserved = observedEntries[0];
              const lastObserved = observedEntries[observedEntries.length - 1];

              const payload: CapturePayload = {
                version: 1,
                checkpoint,
                project: {
                  projectLink,
                  projectLabel: clipSummary(projectLabelFromLink(projectLink)),
                },
                observation: {
                  fromEntryId: firstObserved?.id ?? messages[0].entryId,
                  toEntryId: lastObserved?.id ?? messages[messages.length - 1].entryId,
                  entryCount: observedEntries.length,
                },
                messages,
                scratchpad,
              };

              return {
                _tag: "Payload",
                payload,
                warnings,
              } satisfies BuildPayloadResult;
            })(),
          ),
      ),
    }),
  );
}
