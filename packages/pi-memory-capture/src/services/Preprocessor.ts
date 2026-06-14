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
import {
  type CapturePayload,
  type PayloadMessage,
  type PayloadObservation,
  type TriggerKind,
} from "../schema.ts";
import { sanitizeVisibleText, truncateMessageText } from "../text.ts";

type UserVisibleBlock = TextContent | ImageContent;
type AssistantVisibleBlock = TextContent | ThinkingContent | ToolCall;

interface ObservedPayloadMessage {
  readonly entryId: string;
  readonly message: PayloadMessage;
}

export type BuildPayloadResult =
  | {
      readonly _tag: "NoMessages";
      readonly warnings: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Payload";
      readonly payload: CapturePayload;
      readonly observation: PayloadObservation;
      readonly warnings: ReadonlyArray<string>;
    };

const isUserMessage = (message: SessionMessageEntry["message"]): message is UserMessage =>
  message.role === "user";

const isAssistantMessage = (message: SessionMessageEntry["message"]): message is AssistantMessage =>
  message.role === "assistant";

const isTextBlock = (value: UserVisibleBlock | AssistantVisibleBlock): value is TextContent =>
  value.type === "text";

const extractUserText = (message: UserMessage): string => {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n\n");
};

const extractAssistantText = (message: AssistantMessage): string =>
  message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n\n");

const toPayloadMessage = (entry: SessionMessageEntry): ObservedPayloadMessage | undefined => {
  if (isUserMessage(entry.message)) {
    const sanitized = sanitizeVisibleText(extractUserText(entry.message));
    if (sanitized.length === 0) {
      return undefined;
    }

    return {
      entryId: entry.id,
      message: {
        role: "user",
        text: truncateMessageText(sanitized).text,
      },
    };
  }

  if (!isAssistantMessage(entry.message)) {
    return undefined;
  }

  const sanitized = sanitizeVisibleText(extractAssistantText(entry.message));
  if (sanitized.length === 0) {
    return undefined;
  }

  return {
    entryId: entry.id,
    message: {
      role: "assistant",
      text: truncateMessageText(sanitized).text,
    },
  };
};

export class Preprocessor extends Context.Service<
  Preprocessor,
  {
    readonly buildPayload: (
      triggerKind: TriggerKind,
      projectSlug: string,
      observedEntries: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<BuildPayloadResult>;
  }
>()("@urban/pi-memory-capture/services/Preprocessor") {
  static readonly layer = Layer.succeed(
    Preprocessor,
    Preprocessor.of({
      buildPayload: Effect.fn("Preprocessor.buildPayload")(
        (_triggerKind, projectSlug, observedEntries) =>
          Effect.succeed(
            (() => {
              const observedMessages: ObservedPayloadMessage[] = [];
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

                if (observedMessages.length >= MESSAGE_LIMIT) {
                  warnings.push(
                    `Message count reached ${MESSAGE_LIMIT}; later messages were omitted.`,
                  );
                  break;
                }

                if (payloadChars + payloadMessage.message.text.length > PAYLOAD_CHAR_LIMIT) {
                  warnings.push(
                    `Payload text reached ${PAYLOAD_CHAR_LIMIT} characters; later messages were omitted.`,
                  );
                  break;
                }

                observedMessages.push(payloadMessage);
                payloadChars += payloadMessage.message.text.length;
              }

              const firstObservedId = observedEntries[0]?.id ?? observedMessages[0]?.entryId;
              const lastObservedId =
                observedEntries[observedEntries.length - 1]?.id ??
                observedMessages[observedMessages.length - 1]?.entryId;

              if (
                observedMessages.length === 0 ||
                firstObservedId === undefined ||
                lastObservedId === undefined
              ) {
                return {
                  _tag: "NoMessages",
                  warnings,
                } satisfies BuildPayloadResult;
              }

              const messages = observedMessages.map((entry) => entry.message);

              return {
                _tag: "Payload",
                payload: {
                  version: 1,
                  projectSlug,
                  messages,
                },
                observation: {
                  fromEntryId: firstObservedId,
                  toEntryId: lastObservedId,
                  entryCount: observedEntries.length,
                  messageCount: messages.length,
                },
                warnings,
              } satisfies BuildPayloadResult;
            })(),
          ),
      ),
    }),
  );
}
