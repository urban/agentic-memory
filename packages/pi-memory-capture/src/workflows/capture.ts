import { Clock, Effect, Random, Semaphore } from "effect";
import { CAPTURE_BATCH_SIZE, MARKER_VERSION } from "../constants.ts";
import { formatIsoFromMillis } from "../project.ts";
import { decodeAttemptId } from "../schema.ts";
import { CaptureConfig } from "../services/CaptureConfig.ts";
import { Markers } from "../services/Markers.ts";
import { MemorySteward } from "../services/MemorySteward.ts";
import { Preprocessor } from "../services/Preprocessor.ts";

type SessionEntry = import("@earendil-works/pi-coding-agent").SessionEntry;
type StewardSessionPointer =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardSessionPointer;
type StewardDecisionReport =
  import("@urban/agentic-memory-core/steward/StewardResult").StewardDecisionReport;
type AttemptId = import("../schema.ts").AttemptId;
type CaptureMarker = import("../schema.ts").CaptureMarker;
type PayloadObservation = import("../schema.ts").PayloadObservation;
type TriggerKind = import("../schema.ts").TriggerKind;

export type CaptureExecutionStatus =
  | "captured"
  | "no_changes"
  | "failed"
  | "ignored"
  | "below_threshold"
  | "no_new_activity"
  | "no_capturable_messages";

export interface CaptureExecution {
  readonly status: CaptureExecutionStatus;
  readonly summary: string;
  readonly warnings: ReadonlyArray<string>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly markers: ReadonlyArray<CaptureMarker>;
  readonly captureRunId: string;
  readonly attemptId?: AttemptId;
  readonly stewardSession?: StewardSessionPointer;
  readonly decisionReport?: StewardDecisionReport;
}

export interface CaptureCommandInput {
  readonly cwd: string;
  readonly branch: ReadonlyArray<SessionEntry>;
  readonly triggerKind: TriggerKind;
  readonly timeoutMillis: number;
  readonly force: boolean;
}

const captureSemaphores = new Map<string, Semaphore.Semaphore>();

const captureSemaphoreFor = (cwd: string): Semaphore.Semaphore => {
  const existing = captureSemaphores.get(cwd);
  if (existing !== undefined) {
    return existing;
  }

  const created = Semaphore.makeUnsafe(1);
  captureSemaphores.set(cwd, created);
  return created;
};

const nowValues = Clock.clockWith((clock) =>
  Effect.sync(() => ({
    isoTimestamp: formatIsoFromMillis(clock.currentTimeMillisUnsafe()),
  })),
);

const makeCaptureRunId = Effect.fn("MemoryCapture.makeCaptureRunId")(function* () {
  return yield* Random.nextUUIDv4;
});

const makeAttemptId = Effect.fn("MemoryCapture.makeAttemptId")(function* () {
  const uuid = yield* Random.nextUUIDv4;
  return yield* decodeAttemptId(uuid).pipe(Effect.catch((cause) => Effect.die(cause)));
});

const makeObservationMarker = (input: {
  readonly attemptId: AttemptId;
  readonly timestamp: string;
  readonly triggerKind: TriggerKind;
  readonly observation: PayloadObservation;
  readonly status: "captured" | "no_changes";
  readonly summary: string | undefined;
}): CaptureMarker =>
  input.status === "captured"
    ? {
        markerVersion: MARKER_VERSION,
        kind: "observation_result",
        attemptId: input.attemptId,
        timestamp: input.timestamp,
        triggerKind: input.triggerKind,
        observation: input.observation,
        observationStatus: "captured",
        summary: input.summary ?? "Record durable memory changes",
      }
    : input.summary === undefined
      ? {
          markerVersion: MARKER_VERSION,
          kind: "observation_result",
          attemptId: input.attemptId,
          timestamp: input.timestamp,
          triggerKind: input.triggerKind,
          observation: input.observation,
          observationStatus: "no_changes",
        }
      : {
          markerVersion: MARKER_VERSION,
          kind: "observation_result",
          attemptId: input.attemptId,
          timestamp: input.timestamp,
          triggerKind: input.triggerKind,
          observation: input.observation,
          observationStatus: "no_changes",
          summary: input.summary,
        };

const makeScheduleMarker = (input: {
  readonly attemptId: AttemptId;
  readonly timestamp: string;
  readonly triggerKind: TriggerKind;
  readonly observation: PayloadObservation;
  readonly sendStatus: "succeeded" | "failed";
  readonly retryFailureReasons: ReadonlyArray<string>;
}): CaptureMarker => ({
  markerVersion: MARKER_VERSION,
  kind: "schedule_result",
  attemptId: input.attemptId,
  timestamp: input.timestamp,
  triggerKind: input.triggerKind,
  observation: input.observation,
  sendStatus: input.sendStatus,
  retryFailureReasons: [...input.retryFailureReasons],
});

export const timeoutForTrigger = (triggerKind: TriggerKind): number => {
  switch (triggerKind) {
    case "agent_end":
      return 20_000;
    case "session_before_tree":
      return 12_000;
    case "session_shutdown":
      return 8_000;
  }
};

const stewardSessionAttributes = (
  stewardSession: StewardSessionPointer | undefined,
): Record<string, unknown> =>
  stewardSession === undefined
    ? {}
    : {
        "capture.steward.session_id": stewardSession.sessionId,
        "capture.steward.session_name": stewardSession.name,
        "capture.steward.session_cwd": stewardSession.cwd,
        "capture.steward.session_started_at": stewardSession.startedAt,
      };

const decisionReportAttributes = (
  decisionReport: StewardDecisionReport,
): Record<string, unknown> => ({
  "capture.decision.durability": decisionReport.durability,
  "capture.decision.selected_count": decisionReport.selectedDestinations.length,
  "capture.decision.skipped_count": decisionReport.skippedDestinations.length,
  "capture.decision.summary": decisionReport.decisionSummary,
});

const annotateFinalStatus = (attributes: Record<string, unknown>): Effect.Effect<void> =>
  Effect.annotateCurrentSpan(attributes);

export const runCapturePass = (
  input: CaptureCommandInput,
): Effect.Effect<CaptureExecution, never, CaptureConfig | Markers | Preprocessor | MemorySteward> =>
  captureSemaphoreFor(input.cwd)
    .withPermit(
      Effect.gen(function* () {
        const captureRunId = yield* makeCaptureRunId();
        const baseAttributes = {
          "capture.run_id": captureRunId,
          "capture.trigger_kind": input.triggerKind,
          "capture.force": input.force,
        };
        yield* Effect.annotateCurrentSpan(baseAttributes);

        const config = yield* CaptureConfig;
        const markers = yield* Markers;
        const preprocessor = yield* Preprocessor;
        const steward = yield* MemorySteward;
        const currentConfig = yield* config
          .load(input.cwd)
          .pipe(Effect.withSpan("capture.load_config", { attributes: baseAttributes }));

        if (currentConfig._tag !== "valid") {
          const statusAttributes = {
            ...baseAttributes,
            "capture.config_status": currentConfig._tag,
            "capture.status": "ignored",
            "capture.skip_reason":
              currentConfig._tag === "missing" ? "config_missing" : "config_invalid",
          };
          yield* annotateFinalStatus(statusAttributes);
          yield* Effect.logInfo("Capture skipped").pipe(Effect.annotateLogs(statusAttributes));
          return {
            captureRunId,
            status: "ignored",
            summary:
              currentConfig._tag === "missing" ? "Capture not initialized" : currentConfig.message,
            warnings: [],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }

        const scheduleAttributes = {
          ...baseAttributes,
          "capture.project_slug": currentConfig.config.projectSlug,
          "capture.config_status": "valid",
          "capture.batch_size": CAPTURE_BATCH_SIZE,
        };
        const assistantTurnsAfterSchedule = yield* markers
          .completedAssistantTurnsAfterSchedule(input.branch)
          .pipe(Effect.withSpan("capture.check_schedule", { attributes: scheduleAttributes }));
        const scheduleDecisionAttributes = {
          ...scheduleAttributes,
          "capture.assistant_turns_since_schedule": assistantTurnsAfterSchedule,
        };

        if (!input.force && assistantTurnsAfterSchedule < CAPTURE_BATCH_SIZE) {
          const statusAttributes = {
            ...scheduleDecisionAttributes,
            "capture.status": "below_threshold",
            "capture.skip_reason": "assistant_turns_below_batch_size",
          };
          yield* annotateFinalStatus(statusAttributes);
          yield* Effect.logInfo("Capture skipped").pipe(Effect.annotateLogs(statusAttributes));
          return {
            captureRunId,
            status: "below_threshold",
            summary: `Waiting for ${CAPTURE_BATCH_SIZE} assistant turns before capture.`,
            warnings: [],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }
        if (input.force && assistantTurnsAfterSchedule === 0) {
          const statusAttributes = {
            ...scheduleDecisionAttributes,
            "capture.status": "no_new_activity",
            "capture.skip_reason": "no_assistant_turns_after_schedule",
          };
          yield* annotateFinalStatus(statusAttributes);
          yield* Effect.logInfo("Capture skipped").pipe(Effect.annotateLogs(statusAttributes));
          return {
            captureRunId,
            status: "no_new_activity",
            summary: "No completed assistant turns after the latest schedule marker.",
            warnings: [],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }

        const selection = yield* markers.selectObservation(input.branch).pipe(
          Effect.withSpan("capture.select_observation", {
            attributes: scheduleDecisionAttributes,
          }),
        );
        const selectionAttributes = {
          ...scheduleDecisionAttributes,
          "capture.observation.entry_count": selection.observedEntries.length,
          "capture.observation.message_count": selection.capturableMessages.length,
        };
        yield* Effect.annotateCurrentSpan(selectionAttributes);

        const payloadResult = yield* preprocessor
          .buildPayload(
            input.triggerKind,
            currentConfig.config.projectSlug,
            selection.observedEntries,
          )
          .pipe(Effect.withSpan("capture.build_payload", { attributes: selectionAttributes }));

        if (payloadResult._tag === "NoMessages") {
          const warnings = [...selection.state.decodeWarnings, ...payloadResult.warnings];
          const statusAttributes = {
            ...selectionAttributes,
            "capture.payload.warning_count": payloadResult.warnings.length,
            "capture.status": "no_capturable_messages",
            "capture.skip_reason": "payload_has_no_messages",
          };
          yield* annotateFinalStatus(statusAttributes);
          yield* Effect.logInfo("Capture skipped").pipe(Effect.annotateLogs(statusAttributes));
          return {
            captureRunId,
            status: "no_capturable_messages",
            summary: "Selected window contained no capturable user or assistant messages.",
            warnings,
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }

        const payloadAttributes = {
          ...selectionAttributes,
          "capture.observation.from_entry_id": payloadResult.observation.fromEntryId,
          "capture.observation.to_entry_id": payloadResult.observation.toEntryId,
          "capture.observation.entry_count": payloadResult.observation.entryCount,
          "capture.observation.message_count": payloadResult.observation.messageCount,
          "capture.payload.message_count": payloadResult.payload.messages.length,
          "capture.payload.warning_count": payloadResult.warnings.length,
        };
        yield* Effect.annotateCurrentSpan(payloadAttributes);

        const time = yield* nowValues;
        const attemptId = yield* makeAttemptId();
        const attemptAttributes = {
          ...payloadAttributes,
          "capture.attempt_id": attemptId,
        };
        yield* Effect.annotateCurrentSpan(attemptAttributes);
        const stewardResult = yield* steward
          .run({
            projectRoot: input.cwd,
            payload: payloadResult.payload,
            payloadWarnings: payloadResult.warnings,
            timeoutMillis: input.timeoutMillis,
            captureRunId,
            attemptId,
            triggerKind: input.triggerKind,
            projectSlug: currentConfig.config.projectSlug,
          })
          .pipe(Effect.withSpan("capture.run_steward", { attributes: attemptAttributes }));

        if (stewardResult._tag === "Failed") {
          const markersToWrite = [
            makeScheduleMarker({
              attemptId,
              timestamp: time.isoTimestamp,
              triggerKind: input.triggerKind,
              observation: payloadResult.observation,
              sendStatus: "failed",
              retryFailureReasons: stewardResult.retryFailureReasons,
            }),
          ];
          const statusAttributes = {
            ...attemptAttributes,
            ...stewardSessionAttributes(stewardResult.stewardSession),
            "capture.status": "failed",
            "capture.steward.status": "failed",
            "capture.steward.retry_count": stewardResult.retryFailureReasons.length,
            "capture.marker_count": markersToWrite.length,
            "capture.changed_files_count": 0,
          };
          yield* annotateFinalStatus(statusAttributes);
          yield* Effect.logWarning("Memory Steward failed after retries").pipe(
            Effect.annotateLogs(statusAttributes),
          );
          return {
            captureRunId,
            attemptId,
            ...(stewardResult.stewardSession === undefined
              ? {}
              : { stewardSession: stewardResult.stewardSession }),
            status: "failed",
            summary: "Memory Steward send failed after retries.",
            warnings: [...selection.state.decodeWarnings, ...payloadResult.warnings],
            changedFiles: [],
            markers: markersToWrite,
          } satisfies CaptureExecution;
        }

        const observationMarker = makeObservationMarker({
          attemptId,
          timestamp: time.isoTimestamp,
          triggerKind: input.triggerKind,
          observation: payloadResult.observation,
          status: stewardResult.result.status,
          summary: stewardResult.result.summary,
        });
        const scheduleMarker = makeScheduleMarker({
          attemptId,
          timestamp: time.isoTimestamp,
          triggerKind: input.triggerKind,
          observation: payloadResult.observation,
          sendStatus: "succeeded",
          retryFailureReasons: stewardResult.retryFailureReasons,
        });
        const markersToWrite = [observationMarker, scheduleMarker];
        const statusAttributes = {
          ...attemptAttributes,
          ...stewardSessionAttributes(stewardResult.stewardSession),
          ...decisionReportAttributes(stewardResult.result.decisionReport),
          "capture.status": stewardResult.result.status,
          "capture.steward.status": stewardResult.result.status,
          "capture.steward.retry_count": stewardResult.retryFailureReasons.length,
          "capture.changed_files_count": stewardResult.result.filesChanged.length,
          "capture.marker_count": markersToWrite.length,
        };
        yield* annotateFinalStatus(statusAttributes);
        yield* Effect.logInfo("Memory Steward completed").pipe(
          Effect.annotateLogs(statusAttributes),
        );

        return {
          captureRunId,
          attemptId,
          decisionReport: stewardResult.result.decisionReport,
          ...(stewardResult.stewardSession === undefined
            ? {}
            : { stewardSession: stewardResult.stewardSession }),
          status: stewardResult.result.status,
          summary: stewardResult.result.summary ?? "No durable memory changes",
          warnings: [
            ...selection.state.decodeWarnings,
            ...payloadResult.warnings,
            ...stewardResult.result.warnings,
          ],
          changedFiles: stewardResult.result.filesChanged,
          markers: markersToWrite,
        } satisfies CaptureExecution;
      }),
    )
    .pipe(Effect.withSpan("agentic-memory.capture"));
