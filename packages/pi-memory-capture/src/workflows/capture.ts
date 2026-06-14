import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Clock, Effect, Random, Semaphore } from "effect";
import { CAPTURE_BATCH_SIZE, MARKER_VERSION } from "../constants.ts";
import { formatIsoFromMillis } from "../project.ts";
import {
  decodeAttemptId,
  type AttemptId,
  type CaptureMarker,
  type PayloadObservation,
  type TriggerKind,
} from "../schema.ts";
import { CaptureConfig } from "../services/CaptureConfig.ts";
import { Markers } from "../services/Markers.ts";
import { MemorySteward } from "../services/MemorySteward.ts";
import { Preprocessor } from "../services/Preprocessor.ts";

export interface CaptureExecution {
  readonly status:
    | "captured"
    | "no_changes"
    | "failed"
    | "ignored"
    | "below_threshold"
    | "no_new_activity"
    | "no_capturable_messages";
  readonly summary: string;
  readonly warnings: ReadonlyArray<string>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly markers: ReadonlyArray<CaptureMarker>;
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

export const runCapturePass = (
  input: CaptureCommandInput,
): Effect.Effect<CaptureExecution, never, CaptureConfig | Markers | Preprocessor | MemorySteward> =>
  captureSemaphoreFor(input.cwd)
    .withPermit(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const markers = yield* Markers;
        const preprocessor = yield* Preprocessor;
        const steward = yield* MemorySteward;
        const currentConfig = yield* config.load(input.cwd);

        if (currentConfig._tag !== "valid") {
          return {
            status: "ignored",
            summary:
              currentConfig._tag === "missing" ? "Capture not initialized" : currentConfig.message,
            warnings: [],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }

        const assistantTurnsAfterSchedule = yield* markers.completedAssistantTurnsAfterSchedule(
          input.branch,
        );
        if (!input.force && assistantTurnsAfterSchedule < CAPTURE_BATCH_SIZE) {
          return {
            status: "below_threshold",
            summary: `Waiting for ${CAPTURE_BATCH_SIZE} assistant turns before capture.`,
            warnings: [],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }
        if (input.force && assistantTurnsAfterSchedule === 0) {
          return {
            status: "no_new_activity",
            summary: "No completed assistant turns after the latest schedule marker.",
            warnings: [],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }

        const selection = yield* markers.selectObservation(input.branch);
        const payloadResult = yield* preprocessor.buildPayload(
          input.triggerKind,
          currentConfig.config.projectSlug,
          selection.observedEntries,
        );

        if (payloadResult._tag === "NoMessages") {
          return {
            status: "no_capturable_messages",
            summary: "Selected window contained no capturable user or assistant messages.",
            warnings: [...selection.state.decodeWarnings, ...payloadResult.warnings],
            changedFiles: [],
            markers: [],
          } satisfies CaptureExecution;
        }

        const time = yield* nowValues;
        const attemptId = yield* makeAttemptId();
        const stewardResult = yield* steward.run({
          projectRoot: input.cwd,
          payload: payloadResult.payload,
          payloadWarnings: payloadResult.warnings,
          timeoutMillis: input.timeoutMillis,
        });

        if (stewardResult._tag === "Failed") {
          return {
            status: "failed",
            summary: "Memory Steward send failed after retries.",
            warnings: selection.state.decodeWarnings,
            changedFiles: [],
            markers: [
              makeScheduleMarker({
                attemptId,
                timestamp: time.isoTimestamp,
                triggerKind: input.triggerKind,
                observation: payloadResult.observation,
                sendStatus: "failed",
                retryFailureReasons: stewardResult.retryFailureReasons,
              }),
            ],
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

        return {
          status: stewardResult.result.status,
          summary: stewardResult.result.summary ?? "No durable memory changes",
          warnings: [
            ...selection.state.decodeWarnings,
            ...payloadResult.warnings,
            ...stewardResult.result.warnings,
          ],
          changedFiles: stewardResult.result.filesChanged,
          markers: [observationMarker, scheduleMarker],
        } satisfies CaptureExecution;
      }),
    )
    .pipe(Effect.withSpan("MemoryCapture.runCapturePass"));
