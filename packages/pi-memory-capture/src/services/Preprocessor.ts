import { shapeCapturePayload } from "@urban/agentic-memory-core/capture/PayloadShaping";
import { Context, Effect, Layer } from "effect";
import { sanitizeVisibleText } from "../text.ts";

type AssistantMessage = import("@earendil-works/pi-ai").AssistantMessage;
type ImageContent = import("@earendil-works/pi-ai").ImageContent;
type TextContent = import("@earendil-works/pi-ai").TextContent;
type ThinkingContent = import("@earendil-works/pi-ai").ThinkingContent;
type ToolCall = import("@earendil-works/pi-ai").ToolCall;
type UserMessage = import("@earendil-works/pi-ai").UserMessage;
type SessionEntry = import("@earendil-works/pi-coding-agent").SessionEntry;
type SessionMessageEntry = import("@earendil-works/pi-coding-agent").SessionMessageEntry;
type CapturePayload = import("../schema.ts").CapturePayload;
type PayloadMessage = import("../schema.ts").PayloadMessage;
type PayloadObservation = import("../schema.ts").PayloadObservation;
type TriggerKind = import("../schema.ts").TriggerKind;

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
        text: sanitized,
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
      text: sanitized,
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
        function* (
          _triggerKind,
          projectSlug,
          observedEntries,
        ): Effect.fn.Return<BuildPayloadResult> {
          const observedMessages: ObservedPayloadMessage[] = [];

          for (const entry of observedEntries) {
            if (
              entry.type !== "message" ||
              (entry.message.role !== "user" && entry.message.role !== "assistant")
            ) {
              continue;
            }

            const payloadMessage = toPayloadMessage(entry);
            if (payloadMessage !== undefined) {
              observedMessages.push(payloadMessage);
            }
          }

          const shaped = yield* shapeCapturePayload({
            projectSlug,
            messages: observedMessages.map((entry) => entry.message),
          }).pipe(Effect.catch((cause) => Effect.die(cause)));

          if (shaped._tag !== "Payload" || shaped.payload === undefined) {
            return {
              _tag: "NoMessages",
              warnings: shaped.warnings,
            };
          }

          const payload = shaped.payload;
          const coveredMessageCount = payload.messages.length;
          const lastObservedId = observedMessages[coveredMessageCount - 1]?.entryId;
          if (lastObservedId === undefined) {
            return {
              _tag: "NoMessages",
              warnings: shaped.warnings,
            };
          }

          const lastObservedIndex = observedEntries.findIndex(
            (entry) => entry.id === lastObservedId,
          );
          if (lastObservedIndex === -1) {
            return {
              _tag: "NoMessages",
              warnings: shaped.warnings,
            };
          }

          const coveredEntries = observedEntries.slice(0, lastObservedIndex + 1);
          const firstObservedId = coveredEntries[0]?.id;
          if (firstObservedId === undefined) {
            return {
              _tag: "NoMessages",
              warnings: shaped.warnings,
            };
          }

          return {
            _tag: "Payload",
            payload,
            observation: {
              fromEntryId: firstObservedId,
              toEntryId: lastObservedId,
              entryCount: coveredEntries.length,
              messageCount: coveredMessageCount,
            },
            warnings: shaped.warnings,
          };
        },
      ),
    }),
  );
}
