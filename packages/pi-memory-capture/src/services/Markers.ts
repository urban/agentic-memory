import { Context, Effect, Layer, Option } from "effect";
import { CUSTOM_ENTRY_TYPE } from "../constants.ts";
import { decodeCaptureMarkerOption } from "../markers/CaptureMarker.ts";

type CustomEntry<T = unknown> = import("@earendil-works/pi-coding-agent").CustomEntry<T>;
type SessionEntry = import("@earendil-works/pi-coding-agent").SessionEntry;
type SessionMessageEntry = import("@earendil-works/pi-coding-agent").SessionMessageEntry;
type CaptureMarker = import("../markers/CaptureMarker.ts").CaptureMarker;
type ObservationResultMarker = import("../markers/CaptureMarker.ts").ObservationResultMarker;
type ScheduleResultMarker = import("../markers/CaptureMarker.ts").ScheduleResultMarker;

export interface MarkerEntry<TMarker extends CaptureMarker> {
  readonly entry: CustomEntry<unknown>;
  readonly marker: TMarker;
}

export interface MarkerBranchState {
  readonly latestCapturedObservation: MarkerEntry<ObservationResultMarker> | undefined;
  readonly latestSchedule: MarkerEntry<ScheduleResultMarker> | undefined;
  readonly decodeWarnings: ReadonlyArray<string>;
}

export interface ObservationSelection {
  readonly observedEntries: ReadonlyArray<SessionEntry>;
  readonly capturableMessages: ReadonlyArray<SessionMessageEntry>;
  readonly state: MarkerBranchState;
}

const isCustomMarkerEntry = (entry: SessionEntry): entry is CustomEntry<unknown> =>
  entry.type === "custom" && entry.customType === CUSTOM_ENTRY_TYPE;

export const isCapturableMessageEntry = (entry: SessionEntry): entry is SessionMessageEntry =>
  entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant");

export const isCompletedAssistantTurn = (entry: SessionEntry): entry is SessionMessageEntry =>
  entry.type === "message" && entry.message.role === "assistant";

const decodeMarkerEntry = (
  entry: CustomEntry<unknown>,
): Option.Option<MarkerEntry<CaptureMarker>> =>
  Option.map(decodeCaptureMarkerOption(entry.data), (marker) => ({ entry, marker }));

const isObservationMarker = (marker: CaptureMarker): marker is ObservationResultMarker =>
  marker.kind === "observation_result";

const isCapturedObservationMarker = (marker: CaptureMarker): marker is ObservationResultMarker =>
  marker.kind === "observation_result" && marker.observationStatus === "captured";

const isScheduleMarker = (marker: CaptureMarker): marker is ScheduleResultMarker =>
  marker.kind === "schedule_result";

const scanBranchState = (branch: ReadonlyArray<SessionEntry>): MarkerBranchState => {
  let latestCapturedObservation: MarkerEntry<ObservationResultMarker> | undefined;
  let latestSchedule: MarkerEntry<ScheduleResultMarker> | undefined;
  const decodeWarnings: string[] = [];

  for (const entry of branch) {
    if (!isCustomMarkerEntry(entry)) {
      continue;
    }

    const decoded = decodeMarkerEntry(entry);
    if (Option.isNone(decoded)) {
      decodeWarnings.push(`Ignoring invalid memory capture marker ${entry.id}`);
      continue;
    }

    if (isCapturedObservationMarker(decoded.value.marker)) {
      latestCapturedObservation = {
        entry,
        marker: decoded.value.marker,
      };
    }
    if (isScheduleMarker(decoded.value.marker)) {
      latestSchedule = {
        entry,
        marker: decoded.value.marker,
      };
    }
  }

  return {
    latestCapturedObservation,
    latestSchedule,
    decodeWarnings,
  };
};

const latestObservationResultFromBranch = (
  branch: ReadonlyArray<SessionEntry>,
): MarkerEntry<ObservationResultMarker> | undefined => {
  let latest: MarkerEntry<ObservationResultMarker> | undefined;

  for (const entry of branch) {
    if (!isCustomMarkerEntry(entry)) {
      continue;
    }

    const decoded = decodeMarkerEntry(entry);
    if (Option.isSome(decoded) && isObservationMarker(decoded.value.marker)) {
      latest = {
        entry,
        marker: decoded.value.marker,
      };
    }
  }

  return latest;
};

const startIndexAfterEntry = (branch: ReadonlyArray<SessionEntry>, entryId: string | undefined) => {
  if (entryId === undefined) {
    return 0;
  }
  const index = branch.findIndex((entry) => entry.id === entryId);
  return index === -1 ? 0 : index + 1;
};

const coveredEntryIdForMarker = <TMarker extends ObservationResultMarker | ScheduleResultMarker>(
  branch: ReadonlyArray<SessionEntry>,
  markerEntry: MarkerEntry<TMarker> | undefined,
): string | undefined =>
  markerEntry === undefined
    ? undefined
    : branch.some((entry) => entry.id === markerEntry.marker.observation.toEntryId)
      ? markerEntry.marker.observation.toEntryId
      : markerEntry.entry.id;

const countAssistantTurnsAfter = (
  branch: ReadonlyArray<SessionEntry>,
  entryId: string | undefined,
): number =>
  branch.slice(startIndexAfterEntry(branch, entryId)).filter(isCompletedAssistantTurn).length;

const selectObservationFromBranch = (branch: ReadonlyArray<SessionEntry>): ObservationSelection => {
  const state = scanBranchState(branch);
  const startIndex = startIndexAfterEntry(
    branch,
    coveredEntryIdForMarker(branch, state.latestCapturedObservation),
  );
  const observedEntries = branch.slice(startIndex);

  return {
    observedEntries,
    capturableMessages: observedEntries.filter(isCapturableMessageEntry),
    state,
  };
};

export class Markers extends Context.Service<
  Markers,
  {
    readonly branchState: (branch: ReadonlyArray<SessionEntry>) => Effect.Effect<MarkerBranchState>;
    readonly latestObservationResult: (
      branch: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<MarkerEntry<ObservationResultMarker> | undefined>;
    readonly selectObservation: (
      branch: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<ObservationSelection>;
    readonly completedAssistantTurnsAfterSchedule: (
      branch: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<number>;
  }
>()("@urban/pi-memory-capture/services/Markers") {
  static readonly layer = Layer.succeed(
    Markers,
    Markers.of({
      branchState: Effect.fn("Markers.branchState")((branch) =>
        Effect.succeed(scanBranchState(branch)),
      ),
      latestObservationResult: Effect.fn("Markers.latestObservationResult")((branch) =>
        Effect.succeed(latestObservationResultFromBranch(branch)),
      ),
      selectObservation: Effect.fn("Markers.selectObservation")((branch) =>
        Effect.succeed(selectObservationFromBranch(branch)),
      ),
      completedAssistantTurnsAfterSchedule: Effect.fn(
        "Markers.completedAssistantTurnsAfterSchedule",
      )((branch) => {
        const state = scanBranchState(branch);
        return Effect.succeed(
          countAssistantTurnsAfter(branch, coveredEntryIdForMarker(branch, state.latestSchedule)),
        );
      }),
    }),
  );
}
