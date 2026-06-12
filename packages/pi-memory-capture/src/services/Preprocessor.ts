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
import { type CapturePayload, type PayloadMessage, type TriggerKind } from "../schema.ts";
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

    return {
      entryId: entry.id,
      role: "user",
      text: truncateMessageText(sanitized).text,
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
    role: "assistant",
    text: truncateMessageText(sanitized).text,
  };
};

export class Preprocessor extends Context.Service<
  Preprocessor,
  {
    readonly buildPayload: (
      triggerKind: TriggerKind,
      projectLink: string,
      observedEntries: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<BuildPayloadResult>;
  }
>()("@urban/pi-memory-capture/services/Preprocessor") {
  static readonly layer = Layer.succeed(
    Preprocessor,
    Preprocessor.of({
      buildPayload: Effect.fn("Preprocessor.buildPayload")(
        (triggerKind, projectLink, observedEntries) =>
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

              const firstObservedId = observedEntries[0]?.id ?? messages[0]?.entryId;
              const lastObservedId =
                observedEntries[observedEntries.length - 1]?.id ??
                messages[messages.length - 1]?.entryId;

              if (
                messages.length === 0 ||
                firstObservedId === undefined ||
                lastObservedId === undefined
              ) {
                return {
                  _tag: "NoMessages",
                  warnings,
                } satisfies BuildPayloadResult;
              }

              return {
                _tag: "Payload",
                payload: {
                  version: 1,
                  triggerKind,
                  project: {
                    projectLink,
                    projectLabel: clipSummary(projectLabelFromLink(projectLink)),
                  },
                  observation: {
                    fromEntryId: firstObservedId,
                    toEntryId: lastObservedId,
                    entryCount: observedEntries.length,
                    messageCount: messages.length,
                  },
                  messages,
                },
                warnings,
              } satisfies BuildPayloadResult;
            })(),
          ),
      ),
    }),
  );
}
