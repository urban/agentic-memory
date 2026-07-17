import packageJson from "../package.json" with { type: "json" };

export const PACKAGE_VERSION = packageJson.version;
export const CUSTOM_ENTRY_TYPE = "agentic-memory-capture";
export const MARKER_VERSION = 1;
export const CAPTURE_BATCH_SIZE = 10;
export const RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MILLIS = [1_000, 2_000];
export const MESSAGE_CHAR_LIMIT = 6_000;
export const MESSAGE_LIMIT = 80;
export const PAYLOAD_CHAR_LIMIT = 80_000;
export const RESULT_SUMMARY_CHAR_LIMIT = 50;
export const TRUNCATION_SUFFIX = " [truncated]";
export const MESSAGE_TRUNCATION_SUFFIX = "\n[message truncated to 6000 chars]";
export const GIT_EXCLUDE_ENTRY = ".agentic-memory-link/";
