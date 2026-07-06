import { Effect } from "effect";
import {
  decodeCapturePayload,
  MESSAGE_CHAR_LIMIT,
  MESSAGE_LIMIT,
  MESSAGE_TRUNCATION_SUFFIX,
  PAYLOAD_CHAR_LIMIT,
  type CaptureMessageRole,
  type CapturePayload,
} from "./CapturePayload.ts";

export {
  MESSAGE_CHAR_LIMIT,
  MESSAGE_LIMIT,
  MESSAGE_TRUNCATION_SUFFIX,
  PAYLOAD_CHAR_LIMIT,
} from "./CapturePayload.ts";

const SECRET_ASSIGNMENT_PATTERN =
  /^([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PRIVATE)[A-Z0-9_]*\s*=\s*)(.+)$/gm;
const MULTI_BLANK_LINES_PATTERN = /\n{4,}/g;

export interface ShapeableCaptureMessage {
  readonly role: CaptureMessageRole;
  readonly text: string;
}

export interface ShapeCapturePayloadInput {
  readonly projectSlug: string;
  readonly messages: ReadonlyArray<ShapeableCaptureMessage>;
}

export type ShapeCapturePayloadResult =
  | {
      readonly _tag: "NoMessages";
      readonly warnings: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Payload";
      readonly payload: CapturePayload;
      readonly warnings: ReadonlyArray<string>;
    };

export const truncateWithSuffix = (value: string, maxChars: number, suffix: string): string => {
  if (value.length <= maxChars) {
    return value;
  }

  const contentLimit = Math.max(0, maxChars - suffix.length);
  return `${value.slice(0, contentLimit)}${suffix}`;
};

export const redactSecrets = (value: string): string =>
  value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY BLOCK]",
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]");

export const normalizeMessageText = (value: string): string =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .replace(MULTI_BLANK_LINES_PATTERN, "\n\n");

export const sanitizeVisibleText = (value: string): string =>
  normalizeMessageText(redactSecrets(value));

export const truncateMessageText = (
  value: string,
): {
  readonly text: string;
  readonly truncated: boolean;
} => {
  if (value.length <= MESSAGE_CHAR_LIMIT) {
    return { text: value, truncated: false };
  }

  const contentLimit = MESSAGE_CHAR_LIMIT - MESSAGE_TRUNCATION_SUFFIX.length;
  return {
    text: `${value.slice(0, Math.max(0, contentLimit))}${MESSAGE_TRUNCATION_SUFFIX}`,
    truncated: true,
  };
};

export const shapeCapturePayload = Effect.fnUntraced(function* (input: ShapeCapturePayloadInput) {
  const messages: ShapeableCaptureMessage[] = [];
  const warnings: string[] = [];
  let payloadChars = 0;

  for (const rawMessage of input.messages) {
    const sanitized = sanitizeVisibleText(rawMessage.text);
    if (sanitized.length === 0) {
      warnings.push("Whitespace-only message omitted from capture payload.");
      continue;
    }

    if (messages.length >= MESSAGE_LIMIT) {
      warnings.push(`Message count reached ${MESSAGE_LIMIT}; later messages were omitted.`);
      break;
    }

    const truncated = truncateMessageText(sanitized);
    if (truncated.truncated) {
      warnings.push(`A message was truncated to ${MESSAGE_CHAR_LIMIT} characters.`);
    }

    if (payloadChars + truncated.text.length > PAYLOAD_CHAR_LIMIT) {
      warnings.push(
        `Payload text reached ${PAYLOAD_CHAR_LIMIT} characters; later messages were omitted.`,
      );
      break;
    }

    messages.push({
      role: rawMessage.role,
      text: truncated.text,
    });
    payloadChars += truncated.text.length;
  }

  if (messages.length === 0) {
    return {
      _tag: "NoMessages",
      warnings,
    };
  }

  const payload = yield* decodeCapturePayload({
    version: 1,
    projectSlug: input.projectSlug,
    messages,
  });

  return {
    _tag: "Payload",
    payload,
    warnings,
  };
});
