import packageJson from "../package.json" with { type: "json" };

export const PACKAGE_VERSION = packageJson.version;
export const CAPTURE_DIRECTORY = ".pi/agentic-memory-capture" as const;
export const CONFIG_FILENAME = "config.json" as const;
export const SCRATCHPAD_FILENAME = "scratchpad.json" as const;
export const CUSTOM_ENTRY_TYPE = "agentic-memory-capture" as const;
export const MARKER_VERSION = 1 as const;
export const MESSAGE_CHAR_LIMIT = 6_000 as const;
export const MESSAGE_LIMIT = 80 as const;
export const PAYLOAD_CHAR_LIMIT = 80_000 as const;
export const SCRATCHPAD_CANDIDATE_LIMIT = 25 as const;
export const CANDIDATE_SUMMARY_CHAR_LIMIT = 500 as const;
export const CANDIDATE_REASON_CHAR_LIMIT = 300 as const;
export const RESULT_SUMMARY_CHAR_LIMIT = 240 as const;
export const TRUNCATION_SUFFIX = " [truncated]" as const;
export const MESSAGE_TRUNCATION_SUFFIX = "\n[message truncated to 6000 chars]" as const;
export const GIT_EXCLUDE_ENTRY = ".pi/agentic-memory-capture/" as const;
export const STEWARD_TOOLS = "read,edit,write,find,grep,ls" as const;
