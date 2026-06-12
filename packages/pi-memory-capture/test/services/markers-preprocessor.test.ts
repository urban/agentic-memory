import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { MARKER_VERSION } from "../../src/constants.ts";
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
const timestamp = "2026-06-05T12:00:00.000Z";
const observation = {
  fromEntryId: "u1",
  toEntryId: "a1",
  entryCount: 2,
  messageCount: 2,
};

describe("Markers", () => {
  it("selects observation after the latest captured observation marker only", () =>
    MarkersRuntime.runPromise(
      Effect.gen(function* () {
        const markers = yield* Markers;
        const user1 = makeUserEntry("u1", "first");
        const captured = makeCustomMarkerEntry(
          "m1",
          {
            markerVersion: MARKER_VERSION,
            kind: "observation_result",
            attemptId: "attempt-1",
            timestamp,
            triggerKind: "agent_end",
            observation,
            observationStatus: "captured",
            summary: "Record first memory",
          },
          "u1",
        );
        const noChanges = makeCustomMarkerEntry(
          "m2",
          {
            markerVersion: MARKER_VERSION,
            kind: "observation_result",
            attemptId: "attempt-2",
            timestamp,
            triggerKind: "agent_end",
            observation,
            observationStatus: "no_changes",
          },
          "m1",
        );
        const schedule = makeCustomMarkerEntry(
          "m3",
          {
            markerVersion: MARKER_VERSION,
            kind: "schedule_result",
            attemptId: "attempt-2",
            timestamp,
            triggerKind: "agent_end",
            observation,
            sendStatus: "succeeded",
            retryFailureReasons: [],
          },
          "m2",
        );
        const user2 = makeUserEntry("u2", "second", "m3");
        const assistant2 = makeAssistantEntry("a2", [{ type: "text", text: "answer" }], "u2");
        const branch = [user1, captured, noChanges, schedule, user2, assistant2];

        const selection = yield* markers.selectObservation(branch);
        const turnsAfterSchedule = yield* markers.completedAssistantTurnsAfterSchedule(branch);

        expect(selection.state.latestCapturedObservation?.entry.id).toBe("m1");
        expect(selection.observedEntries.map((entry) => entry.id)).toEqual([
          "m2",
          "m3",
          "u2",
          "a2",
        ]);
        expect(selection.capturableMessages.map((entry) => entry.id)).toEqual(["u2", "a2"]);
        expect(turnsAfterSchedule).toBe(1);
      }),
    ));

  it("tracks failed schedule markers as scheduling anchors", () =>
    MarkersRuntime.runPromise(
      Effect.gen(function* () {
        const markers = yield* Markers;
        const branch = [
          makeUserEntry("u1", "first"),
          makeAssistantEntry("a1", [{ type: "text", text: "one" }], "u1"),
          makeCustomMarkerEntry("s1", {
            markerVersion: MARKER_VERSION,
            kind: "schedule_result",
            attemptId: "attempt-1",
            timestamp,
            triggerKind: "session_shutdown",
            observation,
            sendStatus: "failed",
            retryFailureReasons: [
              "Timed out waiting for steward final JSON after child process launch",
              "Steward returned EOF before final assistant JSON response was emitted",
              "Steward process exited with non-zero status before emitting final JSON",
            ],
          }),
          makeUserEntry("u2", "second", "s1"),
        ];

        const state = yield* markers.branchState(branch);
        const turns = yield* markers.completedAssistantTurnsAfterSchedule(branch);

        expect(state.latestSchedule?.entry.id).toBe("s1");
        expect(state.latestSchedule?.marker.sendStatus).toBe("failed");
        expect(turns).toBe(0);
      }),
    ));
});

describe("Preprocessor", () => {
  it("captures only visible user and assistant text", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload(
          "agent_end",
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
              markerVersion: MARKER_VERSION,
              kind: "schedule_result",
              attemptId: "attempt-1",
              timestamp,
              triggerKind: "agent_end",
              observation,
              sendStatus: "succeeded",
              retryFailureReasons: [],
            }),
          ],
        );

        expect(result._tag).toBe("Payload");
        if (result._tag === "Payload") {
          expect(result.payload.messages).toHaveLength(2);
          expect(result.payload.messages[0]?.text).toContain("[REDACTED_API_KEY]");
          expect(result.payload.messages[0]?.text).not.toContain("image/png");
          expect(result.payload.messages[1]?.text).toBe("Visible answer");
          expect(result.payload.observation.messageCount).toBe(2);
        }
      }),
    ));

  it("leaves anchors unchanged by returning NoMessages for marker-only windows", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload(
          "session_shutdown",
          "[[projects/capture-extension]]",
          [
            makeCustomMarkerEntry("m1", {
              markerVersion: MARKER_VERSION,
              kind: "schedule_result",
              attemptId: "attempt-1",
              timestamp,
              triggerKind: "agent_end",
              observation,
              sendStatus: "succeeded",
              retryFailureReasons: [],
            }),
          ],
        );

        expect(result._tag).toBe("NoMessages");
      }),
    ));
});
