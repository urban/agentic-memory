// @effect-diagnostics nodeBuiltinImport:off
import type { CustomEntry, SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, TextContent, ToolCall, UserMessage } from "@earendil-works/pi-ai";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const timestamp = "2026-06-05T12:00:00.000Z";

const assistantUsage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const assistantMessage = (
  content: ReadonlyArray<
    TextContent | { readonly type: "thinking"; readonly thinking: string } | ToolCall
  >,
): AssistantMessage => ({
  role: "assistant",
  content: [...content],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-5",
  usage: assistantUsage,
  stopReason: "stop",
  timestamp: Date.parse(timestamp),
});

const userMessage = (content: UserMessage["content"]): UserMessage => ({
  role: "user",
  content,
  timestamp: Date.parse(timestamp),
});

export const makeUserEntry = (
  id: string,
  content: UserMessage["content"],
  parentId: string | null = null,
): SessionEntry => ({
  type: "message",
  id,
  parentId,
  timestamp,
  message: userMessage(content),
});

export const makeAssistantEntry = (
  id: string,
  content: AssistantMessage["content"],
  parentId: string | null = null,
): SessionEntry => ({
  type: "message",
  id,
  parentId,
  timestamp,
  message: assistantMessage(content),
});

export const makeCustomMarkerEntry = (
  id: string,
  marker: unknown,
  parentId: string | null = null,
): CustomEntry<unknown> => ({
  type: "custom",
  id,
  parentId,
  timestamp,
  customType: "agentic-memory-capture",
  data: marker,
});

export const makeBranchSummaryEntry = (
  id: string,
  fromId: string,
  summary: string,
  parentId: string | null = null,
): SessionEntry => ({
  type: "branch_summary",
  id,
  parentId,
  timestamp,
  fromId,
  summary,
});

export const makeCompactionEntry = (
  id: string,
  firstKeptEntryId: string,
  summary: string,
  parentId: string | null = null,
): SessionEntry => ({
  type: "compaction",
  id,
  parentId,
  timestamp,
  summary,
  firstKeptEntryId,
  tokensBefore: 100,
});

export const makeSessionManager = (branch: ReadonlyArray<SessionEntry>) => {
  const byId = new Map(branch.map((entry) => [entry.id, entry]));
  const header: SessionHeader = {
    type: "session",
    id: "session",
    cwd: "/project",
    timestamp,
  };

  return {
    getCwd: () => header.cwd,
    getSessionDir: () => "/project/.pi/sessions",
    getSessionId: () => header.id,
    getSessionFile: () => "/project/.pi/sessions/session.jsonl",
    getLeafId: () => branch.at(-1)?.id ?? null,
    getLeafEntry: () => branch.at(-1),
    getEntry: (id: string) => byId.get(id),
    getLabel: (_id: string) => undefined,
    getBranch: () => [...branch],
    getHeader: () => header,
    getEntries: () => [...branch],
    getTree: () =>
      branch.map((entry) => ({
        entry,
        children: [],
      })),
    getSessionName: () => undefined,
  };
};

export const createTempDirectory = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

export const removeTempDirectory = (path: string): void => {
  rmSync(path, { recursive: true, force: true });
};

export const writeFile = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
