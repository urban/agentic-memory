import { Effect } from "effect";
import { encodeCapturePayloadJson, type CapturePayload } from "../capture/CapturePayload.ts";
import type { VaultPaths } from "../vault/VaultStatus.ts";

export interface StewardPromptInput {
  readonly payload: CapturePayload;
  readonly vault: VaultPaths;
  readonly payloadWarnings: ReadonlyArray<string>;
}

export const buildStewardPrompt = Effect.fnUntraced(function* (input: StewardPromptInput) {
  const payloadJson = yield* encodeCapturePayloadJson(input.payload);
  const warningBlock =
    input.payloadWarnings.length === 0
      ? ""
      : `\nPayload warnings:\n${input.payloadWarnings.map((warning) => `- ${warning}`).join("\n")}\n`;

  return [
    "You are running in Memory Steward capture mode.",
    "",
    "The Capture Payload below is the authoritative, bounded, harness-neutral input. Do not infer hidden transcript, branch, tool, image, or reasoning fields beyond it.",
    "",
    `Project slug: ${input.payload.projectSlug}`,
    `Project file path: ${input.vault.projectFile}`,
    `Root memory path: ${input.vault.memoryFile}`,
    `User memory path: ${input.vault.userFile}`,
    "",
    "Use MEMORY.md, USER.md, and the project file as starting routes. Read additional memory only when necessary for a durable update.",
    "",
    "Persist only durable, high-signal memory. Do not store raw transcript material or unbounded session exhaust.",
    "",
    "Prefer small updates to project resume context, project timeline, decision log, USER.md, notes, records, or maps as appropriate. Do not create a records file unless the records policy clearly warrants it.",
    "",
    "Return strict JSON only matching this Steward Result contract: status is captured or no_changes; captured requires summary; summary is max 50 chars, starts with a capital letter, and does not end with a period; filesChanged and warnings are arrays when present.",
    "Include a decisionReport for both captured and no_changes outcomes. The report must summarize observable rationale only: decisionSummary max 500 chars; durability is durable, not_durable, duplicate, insufficient_context, or uncertain; selectedDestinations and skippedDestinations are max 8 entries; durableSignals, duplicateSignals, and privacyNotes are max 5 strings each, max 200 chars each.",
    "The decisionReport must not quote raw transcript text, tool output, diffs, secrets, hidden reasoning, prompts, or full response material.",
    "Use memoryLayer values MEMORY, USER, project, notes, maps, records, people, or sources.",
    warningBlock.trimEnd(),
    "",
    "<CapturePayload>",
    payloadJson,
    "</CapturePayload>",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
});
