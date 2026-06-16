import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeCapturePayloadJson, MESSAGE_CHAR_LIMIT } from "../src/capture/CapturePayload.ts";
import { shapeCapturePayload } from "../src/capture/PayloadShaping.ts";
import { decodeLinkConfigJson } from "../src/link/LinkConfig.ts";
import {
  decodeProjectSlug,
  projectFileRelativePathFromSlug,
  projectWikiLinkFromSlug,
} from "../src/link/ProjectSlug.ts";
import {
  buildPiProcessCommand,
  extractAssistantText,
  extractStewardSessionPointer,
} from "../src/steward/PiProcessRunner.ts";
import { decodeStewardResultJson } from "../src/steward/StewardResult.ts";

const validPayloadJson =
  '{"version":1,"projectSlug":"agentic-memory-cli","messages":[{"role":"user","text":"hello"}]}';

describe("core contracts", () => {
  it.effect("validates project slugs and derives vault routes", () =>
    Effect.gen(function* () {
      const slug = yield* decodeProjectSlug("agentic-memory-cli");
      const invalid = yield* decodeProjectSlug("[[projects/foo]]").pipe(Effect.exit);

      assert.strictEqual(projectWikiLinkFromSlug(slug), "[[projects/agentic-memory-cli]]");
      assert.strictEqual(projectFileRelativePathFromSlug(slug), "projects/agentic-memory-cli.md");
      assert.strictEqual(invalid._tag, "Failure");
    }),
  );

  it.effect(
    "decodes shared link config with projectSlug and rejects projectLink-only configs",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeLinkConfigJson(
          '{"version":1,"vaultPath":"/vault","projectSlug":"agentic-memory-cli"}',
        );
        const oldShape = yield* decodeLinkConfigJson(
          '{"version":1,"vaultPath":"/vault","projectLink":"[[projects/agentic-memory-cli]]"}',
        ).pipe(Effect.exit);

        assert.strictEqual(decoded.projectSlug, "agentic-memory-cli");
        assert.strictEqual(oldShape._tag, "Failure");
      }),
  );

  it.effect("validates capture payloads and shapes visible text", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeCapturePayloadJson(validPayloadJson);
      const empty = yield* decodeCapturePayloadJson(
        '{"version":1,"projectSlug":"agentic-memory-cli","messages":[]}',
      ).pipe(Effect.exit);
      const shaped = yield* shapeCapturePayload({
        projectSlug: "agentic-memory-cli",
        messages: [
          {
            role: "user",
            text: `Bearer sk-ant-1234567890abcdefghijklmnopqrstuvwxyz\n${"x".repeat(7_000)}`,
          },
        ],
      });

      assert.strictEqual(decoded.messages.length, 1);
      assert.strictEqual(empty._tag, "Failure");
      switch (shaped._tag) {
        case "Payload": {
          const text = shaped.payload?.messages[0]?.text ?? "";
          assert.isAtMost(text.length, MESSAGE_CHAR_LIMIT);
          assert.include(text, "Bearer [REDACTED]");
          assert.isTrue(shaped.warnings.some((warning) => warning.includes("truncated")));
          break;
        }
        case "NoMessages":
          assert.fail("expected shaped payload");
      }
    }),
  );

  it.effect("normalizes steward result arrays and requires captured summaries", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeStewardResultJson(
        '{"status":"captured","summary":"Record memory CLI"}',
      );
      const missingSummary = yield* decodeStewardResultJson('{"status":"captured"}').pipe(
        Effect.exit,
      );

      assert.deepStrictEqual(decoded.filesChanged, []);
      assert.deepStrictEqual(decoded.warnings, []);
      assert.strictEqual(missingSummary._tag, "Failure");
    }),
  );

  it.effect("validates bounded steward decision reports when present", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeStewardResultJson(
        '{"status":"no_changes","decisionReport":{"decisionSummary":"No durable memory was observed.","durability":"not_durable","selectedDestinations":[],"skippedDestinations":[{"memoryLayer":"USER","reason":"No stable user preference or owner fact was observed."}],"durableSignals":[],"duplicateSignals":[],"privacyNotes":["No raw transcript text was stored."]}}',
      );
      const oversizedSummary = "x".repeat(501);
      const oversized = yield* decodeStewardResultJson(
        `{"status":"no_changes","decisionReport":{"decisionSummary":"${oversizedSummary}","durability":"uncertain","selectedDestinations":[],"skippedDestinations":[],"durableSignals":[],"duplicateSignals":[],"privacyNotes":[]}}`,
      ).pipe(Effect.exit);

      assert.strictEqual(decoded.decisionReport?.durability, "not_durable");
      assert.strictEqual(oversized._tag, "Failure");
    }),
  );

  it.effect("constructs isolated Pi runner commands and extracts final assistant JSON", () =>
    Effect.gen(function* () {
      const command = buildPiProcessCommand({
        piBinary: "pi-test",
        request: {
          context: {
            status: "ready",
            payload: yield* decodeCapturePayloadJson(validPayloadJson),
            vault: {
              path: "/vault",
              projectFile: "/vault/projects/agentic-memory-cli.md",
              memoryFile: "/vault/MEMORY.md",
              userFile: "/vault/USER.md",
              outsideVaultInstructions: "/vault/.agentic-memory/LLM-outside-vault.md",
            },
            instructions: {
              outsideVault: "contract",
              prompt: "prompt",
            },
            resultContract: {
              statusValues: ["captured", "no_changes"],
              capturedRequiresSummary: true,
            },
            warnings: [],
          },
          correlation: {
            attemptId: "attempt-1",
          },
          options: {
            provider: "anthropic",
            model: "claude",
            thinking: "medium",
          },
        },
      });
      const assistantText = extractAssistantText(
        '{"type":"message_update"}\n{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"{\\"status\\":\\"no_changes\\"}"}]}}\n',
      );

      assert.strictEqual(command.command, "pi-test");
      assert.include(command.args, "--name");
      assert.include(command.args, "Memory Steward capture attempt-1");
      assert.include(command.args, "--no-context-files");
      assert.notInclude(command.args, "--no-session");
      assert.notInclude(command.args, "--continue");
      assert.notInclude(command.args, "--session");
      assert.notInclude(command.args, "--fork");
      assert.notInclude(command.args, "--clone");
      assert.notInclude(command.args, "--no-tools");
      assert.include(command.args, "--provider");
      assert.include(command.args, "anthropic");
      const stewardSession = extractStewardSessionPointer(
        '{"type":"session","version":3,"id":"session-1","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/vault"}\n',
        "Memory Steward capture attempt-1",
      );

      assert.strictEqual(command.cwd, "/vault");
      assert.strictEqual(assistantText, '{"status":"no_changes"}');
      assert.strictEqual(stewardSession?.sessionId, "session-1");
      assert.strictEqual(stewardSession?.name, "Memory Steward capture attempt-1");
    }),
  );
});
