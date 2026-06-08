import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { MARKER_VERSION, PACKAGE_VERSION } from "../../src/constants.ts";
import { emptyScratchpad } from "../../src/scratchpad.ts";
import { Markers } from "../../src/services/Markers.ts";
import { Preprocessor } from "../../src/services/Preprocessor.ts";
import {
  makeAssistantEntry,
  makeBranchSummaryEntry,
  makeCompactionEntry,
  makeCustomMarkerEntry,
  makeUserEntry,
} from "../helpers.ts";

const MarkersRuntime = ManagedRuntime.make(Markers.layer);
const PreprocessorRuntime = ManagedRuntime.make(Preprocessor.layer);

describe("Markers", () => {
  it("selects observation after the latest advancing marker only", () =>
    MarkersRuntime.runPromise(
      Effect.gen(function* () {
        const markers = yield* Markers;
        const user1 = makeUserEntry("u1", "first");
        const success = makeCustomMarkerEntry(
          "m1",
          {
            version: PACKAGE_VERSION,
            markerVersion: MARKER_VERSION,
            status: "captured",
            checkpoint: "manual",
            lastObservedEntryId: "u1",
            observation: {
              fromEntryId: "u1",
              toEntryId: "u1",
              entryCount: 1,
            },
            timestamp: "2026-06-05T12:00:00.000Z",
            summary: "stored",
          },
          "u1",
        );
        const failed = makeCustomMarkerEntry(
          "m2",
          {
            version: PACKAGE_VERSION,
            markerVersion: MARKER_VERSION,
            status: "failed",
            checkpoint: "manual",
            reason: "timed out",
            attemptedObservation: {
              fromEntryId: "u2",
              toEntryId: "u2",
              entryCount: 1,
            },
            timestamp: "2026-06-05T12:05:00.000Z",
          },
          "m1",
        );
        const user2 = makeUserEntry("u2", "second", "m2");
        const branch = [user1, success, failed, user2];

        const selection = yield* markers.selectObservation(branch);
        const latestFailure = yield* markers.latestFailureMarker(
          branch,
          selection.latestAdvancingMarker?.entry.id,
        );

        expect(selection.latestAdvancingMarker?.entry.id).toBe("m1");
        expect(selection.capturableMessages.map((entry) => entry.id)).toEqual(["u2"]);
        expect(latestFailure?.entry.id).toBe("m2");
      }),
    ));
});

describe("Preprocessor", () => {
  it("captures only visible user and assistant text", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload(
          "manual",
          "[[projects/capture-extension]]",
          [
            makeCompactionEntry("c1", "u0", "ignored"),
            makeBranchSummaryEntry("b1", "u0", "ignored"),
            makeUserEntry("u1", [
              { type: "text", text: `Token ${"sk-ant-1234567890abcdefghijklmnopqrstuvwxyz"}` },
              { type: "image", data: "abc", mimeType: "image/png" },
            ]),
            makeAssistantEntry("a1", [
              { type: "text", text: "Visible answer" },
              { type: "thinking", thinking: "hidden chain of thought" },
              { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
            ]),
            makeCustomMarkerEntry("m1", {
              version: PACKAGE_VERSION,
              markerVersion: MARKER_VERSION,
              status: "skipped",
              checkpoint: "manual",
              reason: "ignored",
              timestamp: "2026-06-05T12:00:00.000Z",
            }),
          ],
          emptyScratchpad("[[projects/capture-extension]]", "2026-06-05T12:00:00.000Z"),
        );

        expect(result._tag).toBe("Payload");
        if (result._tag === "Payload") {
          expect(result.payload.messages).toHaveLength(2);
          expect(result.payload.messages[0]?.text).toContain("[REDACTED_API_KEY]");
          expect(result.payload.messages[0]?.text).not.toContain("image/png");
          expect(result.payload.messages[1]?.text).toBe("Visible answer");
        }
      }),
    ));

  it("enforces payload caps and per-message truncation", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const longMessage = "x".repeat(7_000);
        const oversizedEntries = [
          makeUserEntry("u1", longMessage),
          ...Array.from({ length: 20 }, (_, index) =>
            makeAssistantEntry(`a-${index}`, [{ type: "text", text: "z".repeat(7_000) }]),
          ),
        ];

        const result = yield* preprocessor.buildPayload(
          "manual",
          "[[projects/capture-extension]]",
          oversizedEntries,
          emptyScratchpad("[[projects/capture-extension]]", "2026-06-05T12:00:00.000Z"),
        );

        expect(result._tag).toBe("Payload");
        if (result._tag === "Payload") {
          expect(result.payload.messages[0]?.truncated).toBe(true);
          expect(result.warnings.length).toBeGreaterThan(0);
          expect(result.payload.messages.length).toBeLessThan(oversizedEntries.length);
        }
      }),
    ));
});
