import { Schema } from "effect";
import { ProjectSlug } from "../link/ProjectSlug.ts";

export const MESSAGE_CHAR_LIMIT = 6_000;
export const MESSAGE_LIMIT = 80;
export const PAYLOAD_CHAR_LIMIT = 80_000;
export const MESSAGE_TRUNCATION_SUFFIX = "\n[message truncated to 6000 chars]";

export const CaptureMessageRole = Schema.Literals(["user", "assistant"]).annotate({
  identifier: "CaptureMessageRole",
});
export type CaptureMessageRole = typeof CaptureMessageRole.Type;

export const CaptureMessageText = Schema.String.check(
  Schema.isPattern(/\S/, {
    message: "Message text must contain visible non-whitespace content",
  }),
  Schema.isMaxLength(MESSAGE_CHAR_LIMIT),
).annotate({ identifier: "CaptureMessageText" });
export type CaptureMessageText = typeof CaptureMessageText.Type;

export const CapturePayloadMessage = Schema.Struct({
  role: CaptureMessageRole,
  text: CaptureMessageText,
}).annotate({ identifier: "CapturePayloadMessage" });
export type CapturePayloadMessage = typeof CapturePayloadMessage.Type;

const CapturePayloadMessages = Schema.Array(CapturePayloadMessage).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MESSAGE_LIMIT),
);

export const CapturePayload = Schema.Struct({
  version: Schema.Literal(1),
  projectSlug: ProjectSlug,
  messages: CapturePayloadMessages,
})
  .check(
    Schema.makeFilter((payload) => {
      const totalCharacters = payload.messages.reduce(
        (sum, message) => sum + message.text.length,
        0,
      );
      return totalCharacters <= PAYLOAD_CHAR_LIMIT
        ? undefined
        : `Payload text must be at most ${PAYLOAD_CHAR_LIMIT} characters`;
    }),
  )
  .annotate({ identifier: "CapturePayload" });
export type CapturePayload = typeof CapturePayload.Type;

export const CapturePayloadJson = Schema.fromJsonString(CapturePayload).annotate({
  identifier: "CapturePayloadJson",
});

export const decodeCapturePayload = Schema.decodeUnknownEffect(CapturePayload);
export const decodeCapturePayloadJson = Schema.decodeUnknownEffect(CapturePayloadJson);
export const encodeCapturePayloadJson = Schema.encodeUnknownEffect(CapturePayloadJson);
