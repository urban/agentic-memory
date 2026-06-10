import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Clock, Effect, Layer, ManagedRuntime, Semaphore } from "effect";
import { MARKER_VERSION, PACKAGE_VERSION } from "./constants.ts";
import { formatIsoFromMillis } from "./project.ts";
import { emptyScratchpad } from "./scratchpad.ts";
import {
  type CaptureCheckpoint as CaptureCheckpointType,
  type CaptureMarker,
  type NotificationLevel,
  type NonAdvancingCaptureMarker,
} from "./schema.ts";
import { clipSummary } from "./text.ts";
import { Config, type LoadConfigResult } from "./services/Config.ts";
import { Markers } from "./services/Markers.ts";
import { MemorySteward, MemoryStewardError, StewardExecutor } from "./services/MemorySteward.ts";
import { Preprocessor } from "./services/Preprocessor.ts";
import { ScratchpadStore } from "./services/Scratchpad.ts";

export interface CaptureExecution {
  readonly status: "captured" | "no_changes" | "skipped" | "failed" | "ignored" | "no_new_entries";
  readonly summary: string;
  readonly warnings: ReadonlyArray<string>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly marker: CaptureMarker | undefined;
}

export interface StatusResult {
  readonly config: LoadConfigResult;
  readonly latestAdvancingMarkerSummary: string | undefined;
  readonly latestFailureSummary: string | undefined;
  readonly pendingCandidateSummaries: ReadonlyArray<string>;
  readonly automaticCaptureEnabled: boolean;
  readonly warnings: ReadonlyArray<string>;
}

type CaptureSessionManager = ExtensionContext["sessionManager"];
export interface CaptureCommandInput {
  readonly cwd: string;
  readonly sessionManager: CaptureSessionManager;
  readonly checkpoint: CaptureCheckpointType;
  readonly timeoutMillis: number;
  readonly mode: "manual" | "automatic";
  // readonly piBinary: string | undefined;
}

const notificationSummary = (summary: string): string => clipSummary(summary);

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

const checkpointTimeout = (checkpoint: CaptureCheckpointType): number => {
  switch (checkpoint) {
    case "manual":
      return 300_000;
    case "session_before_compact":
      return 20_000;
    case "session_shutdown":
      return 8_000;
    case "session_before_tree":
      return 12_000;
    case "session_before_fork":
      return 12_000;
    case "session_before_clone":
      return 12_000;
  }
};

const makeFailureMarker = (
  checkpoint: CaptureCheckpointType,
  reason: string,
  timestamp: string,
  observedEntries: ReadonlyArray<{ readonly id: string }>,
): NonAdvancingCaptureMarker => ({
  version: PACKAGE_VERSION,
  markerVersion: MARKER_VERSION,
  status: "failed",
  checkpoint,
  reason: notificationSummary(reason),
  attemptedObservation:
    observedEntries.length === 0
      ? undefined
      : {
          fromEntryId: observedEntries[0].id,
          toEntryId: observedEntries[observedEntries.length - 1].id,
          entryCount: observedEntries.length,
        },
  timestamp,
});

const makeSkippedMarker = (
  checkpoint: CaptureCheckpointType,
  reason: string,
  timestamp: string,
  observedEntries: ReadonlyArray<{ readonly id: string }>,
): CaptureMarker => ({
  version: PACKAGE_VERSION,
  markerVersion: MARKER_VERSION,
  status: "skipped",
  checkpoint,
  reason: notificationSummary(reason),
  attemptedObservation:
    observedEntries.length === 0
      ? undefined
      : {
          fromEntryId: observedEntries[0].id,
          toEntryId: observedEntries[observedEntries.length - 1].id,
          entryCount: observedEntries.length,
        },
  timestamp,
});

const makeAdvancingMarker = (
  checkpoint: CaptureCheckpointType,
  status: "captured" | "no_changes",
  timestamp: string,
  summary: string,
  observation: {
    readonly fromEntryId: string;
    readonly toEntryId: string;
    readonly entryCount: number;
  },
): CaptureMarker => ({
  version: PACKAGE_VERSION,
  markerVersion: MARKER_VERSION,
  status,
  checkpoint,
  lastObservedEntryId: observation.toEntryId,
  observation,
  timestamp,
  summary: notificationSummary(summary),
});

const makeStewardExecutorLayer = (pi: ExtensionAPI) =>
  Layer.succeed(
    StewardExecutor,
    StewardExecutor.of({
      exec: (command, args, options) =>
        Effect.tryPromise({
          try: () => pi.exec(command, [...args], options),
          catch: (cause) =>
            new MemoryStewardError({
              message: `Failed to launch Memory Steward command: ${command}`,
              cause,
            }),
        }),
    }),
  );

export const makeMemoryCaptureRuntime = (pi: ExtensionAPI) => {
  const infrastructureLayer = Layer.mergeAll(BunServices.layer, makeStewardExecutorLayer(pi));
  const servicesLayer = Layer.mergeAll(
    ScratchpadStore.layer,
    Markers.layer,
    Preprocessor.layer,
    MemorySteward.layer.pipe(Layer.provideMerge(Config.layer)),
  ).pipe(Layer.provideMerge(infrastructureLayer));

  return ManagedRuntime.make(servicesLayer);
};

const nowValues = Clock.clockWith((clock) =>
  Effect.sync(() => {
    const millis = clock.currentTimeMillisUnsafe();
    return {
      isoTimestamp: formatIsoFromMillis(millis),
    };
  }),
);

export const loadStatus = (
  cwd: string,
  sessionManager: CaptureSessionManager,
): Effect.Effect<StatusResult, never, Config | Markers | ScratchpadStore> =>
  Effect.gen(function* () {
    const config = yield* Config;
    const markers = yield* Markers;
    const scratchpadStore = yield* ScratchpadStore;
    const currentConfig = yield* config.load(cwd);
    const branch = sessionManager.getBranch();
    const latestAdvancing = yield* markers.latestAdvancingMarker(branch);
    const latestFailure = yield* markers.latestFailureMarker(branch, latestAdvancing?.entry.id);
    const time = yield* nowValues;
    const scratchpadResult =
      currentConfig._tag === "valid"
        ? yield* scratchpadStore.load(
            currentConfig.paths.scratchpadFile,
            currentConfig.config.projectLink,
            time.isoTimestamp,
          )
        : {
            scratchpad: emptyScratchpad("[[projects/unknown]]", time.isoTimestamp),
            warnings: [],
          };

    return {
      config: currentConfig,
      latestAdvancingMarkerSummary: latestAdvancing?.marker.summary,
      latestFailureSummary: latestFailure?.marker.reason,
      pendingCandidateSummaries: scratchpadResult.scratchpad.pendingCandidates.map(
        (candidate) => candidate.summary,
      ),
      automaticCaptureEnabled: currentConfig._tag === "valid",
      warnings: scratchpadResult.warnings,
    };
  }).pipe(Effect.withSpan("MemoryCapture.loadStatus"));

export const runCapturePass = (
  input: CaptureCommandInput,
): Effect.Effect<
  CaptureExecution,
  never,
  Config | Markers | ScratchpadStore | Preprocessor | MemorySteward
> =>
  captureSemaphoreFor(input.cwd)
    .withPermit(
      Effect.gen(function* () {
        const config = yield* Config;
        const markers = yield* Markers;
        const scratchpadStore = yield* ScratchpadStore;
        const preprocessor = yield* Preprocessor;
        const steward = yield* MemorySteward;
        const time = yield* nowValues;
        const currentConfig = yield* config.load(input.cwd);

        if (currentConfig._tag !== "valid") {
          return input.mode === "automatic"
            ? ({
                status: "ignored",
                summary:
                  currentConfig._tag === "missing"
                    ? "Capture not initialized"
                    : currentConfig.message,
                warnings: [],
                changedFiles: [],
                marker: undefined,
              } satisfies CaptureExecution)
            : ({
                status: "skipped",
                summary:
                  currentConfig._tag === "missing"
                    ? "Memory capture is not initialized for this project."
                    : currentConfig.message,
                warnings: [],
                changedFiles: [],
                marker: undefined,
              } satisfies CaptureExecution);
        }

        const observation = yield* markers.selectObservation(input.sessionManager.getBranch());
        if (observation.observedEntries.length === 0) {
          return {
            status: "no_new_entries",
            summary: "No new entries to capture.",
            warnings: [],
            changedFiles: [],
            marker: undefined,
          } satisfies CaptureExecution;
        }

        const scratchpad = yield* scratchpadStore.load(
          currentConfig.paths.scratchpadFile,
          currentConfig.config.projectLink,
          time.isoTimestamp,
        );
        const payloadResult = yield* preprocessor.buildPayload(
          input.checkpoint,
          currentConfig.config.projectLink,
          observation.observedEntries,
          scratchpad.scratchpad,
        );

        if (payloadResult._tag === "NoMessages") {
          return {
            status: "skipped",
            summary: "Observed entries contained no capturable visible text.",
            warnings: [...scratchpad.warnings, ...payloadResult.warnings],
            changedFiles: [],
            marker: makeSkippedMarker(
              input.checkpoint,
              "Observed entries contained no capturable visible text.",
              time.isoTimestamp,
              observation.observedEntries,
            ),
          } satisfies CaptureExecution;
        }

        const stewardResult = yield* steward
          .run({
            vaultPath: currentConfig.config.vaultPath,
            payload: payloadResult.payload,
            payloadWarnings: payloadResult.warnings,
            timeoutMillis: input.timeoutMillis,
          })
          .pipe(
            Effect.match({
              onFailure: (error) => ({
                _tag: "failed" as const,
                message: error.message,
              }),
              onSuccess: (result) => ({
                _tag: "result" as const,
                result,
              }),
            }),
          );

        if (stewardResult._tag === "failed") {
          return {
            status: "failed",
            summary: stewardResult.message,
            warnings: scratchpad.warnings,
            changedFiles: [],
            marker: makeFailureMarker(
              input.checkpoint,
              stewardResult.message,
              time.isoTimestamp,
              observation.observedEntries,
            ),
          } satisfies CaptureExecution;
        }

        const scratchpadWarnings =
          stewardResult.result.scratchpad === undefined
            ? []
            : stewardResult.result.scratchpad.projectLink !== currentConfig.config.projectLink
              ? [
                  "Memory Steward returned a scratchpad for a different project; the previous local scratchpad was kept.",
                ]
              : yield* scratchpadStore
                  .write(
                    currentConfig.paths.scratchpadFile,
                    stewardResult.result.scratchpad,
                    time.isoTimestamp,
                  )
                  .pipe(
                    Effect.match({
                      onFailure: (error) => [
                        `Failed to write the local scratchpad; previous local scratchpad was kept: ${error.message}`,
                      ],
                      onSuccess: () => [],
                    }),
                  );

        const warnings = [
          ...scratchpad.warnings,
          ...payloadResult.warnings,
          ...stewardResult.result.warnings,
          ...scratchpadWarnings,
        ];

        if (
          stewardResult.result.status === "captured" ||
          stewardResult.result.status === "no_changes"
        ) {
          return {
            status: stewardResult.result.status,
            summary: stewardResult.result.summary,
            warnings,
            changedFiles: stewardResult.result.filesChanged,
            marker: makeAdvancingMarker(
              input.checkpoint,
              stewardResult.result.status,
              time.isoTimestamp,
              stewardResult.result.summary,
              payloadResult.payload.observation,
            ),
          } satisfies CaptureExecution;
        }

        if (stewardResult.result.status === "failed") {
          return {
            status: "failed",
            summary: stewardResult.result.summary,
            warnings,
            changedFiles: stewardResult.result.filesChanged,
            marker: makeFailureMarker(
              input.checkpoint,
              stewardResult.result.summary,
              time.isoTimestamp,
              observation.observedEntries,
            ),
          } satisfies CaptureExecution;
        }

        return {
          status: stewardResult.result.status,
          summary: stewardResult.result.summary,
          warnings,
          changedFiles: stewardResult.result.filesChanged,
          marker: makeSkippedMarker(
            input.checkpoint,
            stewardResult.result.summary,
            time.isoTimestamp,
            observation.observedEntries,
          ),
        } satisfies CaptureExecution;
      }),
    )
    .pipe(Effect.withSpan("MemoryCapture.runCapturePass"));

export const timeoutForCheckpoint = (checkpoint: CaptureCheckpointType) =>
  checkpointTimeout(checkpoint);

export const checkpointFromForkPosition = (position: "before" | "at"): CaptureCheckpointType =>
  position === "before" ? "session_before_fork" : "session_before_clone";

export const notificationLevelForCapture = (
  execution: CaptureExecution,
  mode: "manual" | "automatic",
): NotificationLevel => {
  if (execution.status === "captured" || execution.status === "no_changes") {
    return "info";
  }
  if (execution.status === "failed") {
    return mode === "manual" ? "error" : "warning";
  }
  if (execution.status === "skipped") {
    return "warning";
  }
  return "info";
};
