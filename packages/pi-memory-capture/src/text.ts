import {
  MESSAGE_CHAR_LIMIT,
  MESSAGE_TRUNCATION_SUFFIX,
  RESULT_SUMMARY_CHAR_LIMIT,
  TRUNCATION_SUFFIX,
} from "./constants.ts";

const SECRET_ASSIGNMENT_PATTERN =
  /^([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PRIVATE)[A-Z0-9_]*\s*=\s*)(.+)$/gm;
const MULTI_BLANK_LINES_PATTERN = /\n{4,}/g;

export const truncateWithSuffix = (value: string, maxChars: number, suffix: string): string => {
  if (value.length <= maxChars) {
    return value;
  }

  const contentLimit = Math.max(0, maxChars - suffix.length);
  return `${value.slice(0, contentLimit)}${suffix}`;
};

export const clipSummary = (value: string): string =>
  truncateWithSuffix(value.trim(), RESULT_SUMMARY_CHAR_LIMIT, TRUNCATION_SUFFIX);

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

export const buildCapturePrompt = (
  payloadJson: string,
  payloadWarnings: ReadonlyArray<string>,
): string => {
  const warningBlock =
    payloadWarnings.length === 0
      ? ""
      : `\nPayload warnings:\n${payloadWarnings.map((warning) => `- ${warning}`).join("\n")}\n`;

  return [
    "You are running in Memory Steward capture mode.",
    "",
    "Process the Capture Payload below according to the Agentic Memory outside-vault contract and `.agentic-memory/instructions/session-capture.md`.",
    "",
    "Persist only durable, high-signal memory. Do not store raw transcript text. Do not create a records file unless the records policy clearly warrants it.",
    "",
    "Return strict JSON only matching the Capture Result schema. Do not include Markdown fences, commentary, or prose outside the JSON object.",
    warningBlock.trimEnd(),
    "",
    "<CapturePayload>",
    payloadJson,
    "</CapturePayload>",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
};
