import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { MESSAGE_LIMIT } from "@urban/agentic-memory-core/capture/PayloadShaping";
import { MARKER_VERSION } from "../../src/markers/CaptureMarker.ts";
import { Markers } from "../../src/services/Markers.ts";
import { Preprocessor } from "../../src/services/Preprocessor.ts";
import {
  makeAssistantEntry,
  makeBranchSummaryEntry,
  makeCompactionEntry,
  makeCustomMarkerEntry,
  makeUserEntry,
} from "../helpers.ts";

type SessionEntry = import("@earendil-works/pi-coding-agent").SessionEntry;

const MarkersRuntime = ManagedRuntime.make(Markers.layer);
const PreprocessorRuntime = ManagedRuntime.make(Preprocessor.layer);
const timestamp = "2026-06-05T12:00:00.000Z";
const observation = {
  fromEntryId: "u1",
  toEntryId: "a1",
  entryCount: 2,
  messageCount: 2,
};

const makeTurnEntries = (count: number): ReadonlyArray<SessionEntry> =>
  Array.from({ length: count }).flatMap((_, index) => {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    return [
      makeUserEntry(userId, `prompt ${index}`, index === 0 ? null : `a${index - 1}`),
      makeAssistantEntry(assistantId, [{ type: "text", text: `answer ${index}` }], userId),
    ];
  });

describe("Markers", () => {
  it("rejects invalid marker envelopes while scanning a branch", () =>
    MarkersRuntime.runPromise(
      Effect.gen(function* () {
        const markers = yield* Markers;
        const state = yield* markers.branchState([
          makeCustomMarkerEntry("m1", {
            markerVersion: MARKER_VERSION,
            kind: "observation_result",
            attemptId: "attempt-1",
            timestamp: "2026-06-05T12:00:00Z",
            triggerKind: "agent_end",
            observation,
            observationStatus: "captured",
            summary: "Record first memory",
          }),
        ]);

        expect(state.latestCapturedObservation).toBeUndefined();
        expect(state.decodeWarnings).toEqual(["Ignoring invalid memory capture marker m1"]);
      }),
    ));

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

  it("uses the covered observation tail instead of the marker position when entries remain", () =>
    MarkersRuntime.runPromise(
      Effect.gen(function* () {
        const markers = yield* Markers;
        const coveredObservation = {
          fromEntryId: "u0",
          toEntryId: "a0",
          entryCount: 2,
          messageCount: 2,
        };
        const branch = [
          makeUserEntry("u0", "first"),
          makeAssistantEntry("a0", [{ type: "text", text: "one" }], "u0"),
          makeUserEntry("u1", "second", "a0"),
          makeAssistantEntry("a1", [{ type: "text", text: "two" }], "u1"),
          makeCustomMarkerEntry("o1", {
            markerVersion: MARKER_VERSION,
            kind: "observation_result",
            attemptId: "attempt-1",
            timestamp,
            triggerKind: "agent_end",
            observation: coveredObservation,
            observationStatus: "captured",
            summary: "Record first memory",
          }),
          makeCustomMarkerEntry("s1", {
            markerVersion: MARKER_VERSION,
            kind: "schedule_result",
            attemptId: "attempt-1",
            timestamp,
            triggerKind: "agent_end",
            observation: coveredObservation,
            sendStatus: "succeeded",
            retryFailureReasons: [],
          }),
        ];

        const selection = yield* markers.selectObservation(branch);
        const turnsAfterSchedule = yield* markers.completedAssistantTurnsAfterSchedule(branch);

        expect(selection.observedEntries.map((entry) => entry.id)).toEqual([
          "u1",
          "a1",
          "o1",
          "s1",
        ]);
        expect(selection.capturableMessages.map((entry) => entry.id)).toEqual(["u1", "a1"]);
        expect(turnsAfterSchedule).toBe(1);
      }),
    ));
});

describe("Preprocessor", () => {
  it("captures only visible user and assistant text", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload("agent_end", "capture-extension", [
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
        ]);

        expect(result._tag).toBe("Payload");
        if (result._tag === "Payload") {
          expect(result.payload.messages).toHaveLength(2);
          expect(result.payload.messages[0]?.text).toContain("[REDACTED_API_KEY]");
          expect(result.payload.messages[0]?.text).not.toContain("image/png");
          expect(result.payload.messages[1]?.text).toBe("Visible answer");
          expect(result.observation.messageCount).toBe(2);
        }
      }),
    ));

  it("leaves anchors unchanged by returning NoMessages for marker-only windows", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload("session_shutdown", "capture-extension", [
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
        ]);

        expect(result._tag).toBe("NoMessages");
      }),
    ));

  it("keeps observation boundaries aligned when core omits whitespace-only messages", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload("agent_end", "capture-extension", [
          makeUserEntry("u0", " \r\n "),
          makeAssistantEntry("a0", [{ type: "text", text: "Visible answer" }], "u0"),
        ]);

        expect(result._tag).toBe("Payload");
        if (result._tag === "Payload") {
          expect(result.payload.messages).toEqual([{ role: "assistant", text: "Visible answer" }]);
          expect(result.observation).toEqual({
            fromEntryId: "u0",
            toEntryId: "a0",
            entryCount: 2,
            messageCount: 1,
          });
          expect(result.warnings.some((warning) => warning.includes("Whitespace-only"))).toBe(true);
        }
      }),
    ));

  it("bounds the reported observation to the last included message when the payload truncates", () =>
    PreprocessorRuntime.runPromise(
      Effect.gen(function* () {
        const preprocessor = yield* Preprocessor;
        const result = yield* preprocessor.buildPayload(
          "session_shutdown",
          "capture-extension",
          makeTurnEntries(MESSAGE_LIMIT / 2 + 1),
        );

        expect(result._tag).toBe("Payload");
        if (result._tag === "Payload") {
          expect(result.payload.messages).toHaveLength(MESSAGE_LIMIT);
          expect(result.observation.fromEntryId).toBe("u0");
          expect(result.observation.toEntryId).toBe("a39");
          expect(result.observation.entryCount).toBe(MESSAGE_LIMIT);
          expect(result.observation.messageCount).toBe(MESSAGE_LIMIT);
          expect(
            result.warnings.some((warning) => warning.includes("later messages were omitted")),
          ).toBe(true);
        }
      }),
    ));
});
