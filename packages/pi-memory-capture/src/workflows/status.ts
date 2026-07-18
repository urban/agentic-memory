import { Effect } from "effect";
import { CaptureConfig } from "../services/CaptureConfig.ts";
import { Markers } from "../services/Markers.ts";

type SessionEntry = import("@earendil-works/pi-coding-agent").SessionEntry;
type CaptureConfigState = import("../services/CaptureConfig.ts").CaptureConfigState;

export interface StatusResult {
  readonly config: CaptureConfigState;
  readonly latestObservationSummary: string | undefined;
  readonly latestObservationStatus: string | undefined;
  readonly latestScheduleSummary: string | undefined;
  readonly latestScheduleStatus: string | undefined;
  readonly automaticCaptureEnabled: boolean;
  readonly warnings: ReadonlyArray<string>;
}

export const loadStatus = (
  cwd: string,
  branch: ReadonlyArray<SessionEntry>,
): Effect.Effect<StatusResult, never, CaptureConfig | Markers> =>
  Effect.gen(function* () {
    const config = yield* CaptureConfig;
    const markers = yield* Markers;
    const currentConfig = yield* config.load(cwd);
    const state = yield* markers.branchState(branch);
    const latestObservation = yield* markers.latestObservationResult(branch);

    return {
      config: currentConfig,
      latestObservationSummary: latestObservation?.marker.summary,
      latestObservationStatus: latestObservation?.marker.observationStatus,
      latestScheduleSummary: state.latestSchedule?.marker.retryFailureReasons.at(-1),
      latestScheduleStatus: state.latestSchedule?.marker.sendStatus,
      automaticCaptureEnabled: currentConfig._tag === "valid",
      warnings: state.decodeWarnings,
    } satisfies StatusResult;
  }).pipe(Effect.withSpan("MemoryCapture.loadStatus"));
