import packageJson from "../package.json" with { type: "json" };

export const PACKAGE_VERSION = packageJson.version;
export const CUSTOM_ENTRY_TYPE = "agentic-memory-capture";
export const MARKER_VERSION = 1;
export const CAPTURE_BATCH_SIZE = 10;
export const RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MILLIS = [1_000, 2_000];
