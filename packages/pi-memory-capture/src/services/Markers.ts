import type {
  CustomEntry,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer, Option } from "effect";
import {
  type AdvancingCaptureMarker,
  type CaptureMarker,
  decodeCaptureMarkerOption,
  type NonAdvancingCaptureMarker,
} from "../schema.ts";
import { CUSTOM_ENTRY_TYPE } from "../constants.ts";

export interface MarkerEntry<TMarker extends CaptureMarker> {
  readonly entry: CustomEntry<unknown>;
  readonly marker: TMarker;
}

export interface ObservationSelection {
  readonly latestAdvancingMarker: MarkerEntry<AdvancingCaptureMarker> | undefined;
  readonly observedEntries: ReadonlyArray<SessionEntry>;
  readonly capturableMessages: ReadonlyArray<SessionMessageEntry>;
}

const isCustomMarkerEntry = (entry: SessionEntry): entry is CustomEntry<unknown> =>
  entry.type === "custom" && entry.customType === CUSTOM_ENTRY_TYPE;

const isCapturableMessageEntry = (entry: SessionEntry): entry is SessionMessageEntry =>
  entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant");

const decodeMarkerEntry = (
  entry: CustomEntry<unknown>,
): Option.Option<MarkerEntry<CaptureMarker>> =>
  Option.map(decodeCaptureMarkerOption(entry.data), (marker) => ({ entry, marker }));

const isAdvancingMarker = (marker: CaptureMarker): marker is AdvancingCaptureMarker =>
  marker.status === "captured" || marker.status === "no_changes";

const isNonAdvancingMarker = (marker: CaptureMarker): marker is NonAdvancingCaptureMarker =>
  marker.status === "failed" || marker.status === "skipped";

const latestAdvancingMarkerFromBranch = (
  branch: ReadonlyArray<SessionEntry>,
): MarkerEntry<AdvancingCaptureMarker> | undefined => {
  let latest: MarkerEntry<AdvancingCaptureMarker> | undefined;

  for (const entry of branch) {
    if (!isCustomMarkerEntry(entry)) {
      continue;
    }

    const decoded = decodeMarkerEntry(entry);
    if (Option.isSome(decoded) && isAdvancingMarker(decoded.value.marker)) {
      latest = {
        entry,
        marker: decoded.value.marker,
      };
    }
  }

  return latest;
};

const latestFailureMarkerFromBranch = (
  branch: ReadonlyArray<SessionEntry>,
  afterEntryId: string | undefined,
): MarkerEntry<NonAdvancingCaptureMarker> | undefined => {
  const afterIndex =
    afterEntryId === undefined ? -1 : branch.findIndex((entry) => entry.id === afterEntryId);
  let latest: MarkerEntry<NonAdvancingCaptureMarker> | undefined;

  for (const entry of branch.slice(afterIndex + 1)) {
    if (!isCustomMarkerEntry(entry)) {
      continue;
    }

    const decoded = decodeMarkerEntry(entry);
    if (Option.isSome(decoded) && isNonAdvancingMarker(decoded.value.marker)) {
      latest = {
        entry,
        marker: decoded.value.marker,
      };
    }
  }

  return latest;
};

export class Markers extends Context.Service<
  Markers,
  {
    readonly latestAdvancingMarker: (
      branch: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<MarkerEntry<AdvancingCaptureMarker> | undefined>;
    readonly latestFailureMarker: (
      branch: ReadonlyArray<SessionEntry>,
      afterEntryId: string | undefined,
    ) => Effect.Effect<MarkerEntry<NonAdvancingCaptureMarker> | undefined>;
    readonly selectObservation: (
      branch: ReadonlyArray<SessionEntry>,
    ) => Effect.Effect<ObservationSelection>;
  }
>()("@urban/pi-memory-capture/services/Markers") {
  static readonly layer = Layer.succeed(
    Markers,
    Markers.of({
      latestAdvancingMarker: Effect.fn("Markers.latestAdvancingMarker")((branch) =>
        Effect.succeed(latestAdvancingMarkerFromBranch(branch)),
      ),
      latestFailureMarker: Effect.fn("Markers.latestFailureMarker")((branch, afterEntryId) =>
        Effect.succeed(latestFailureMarkerFromBranch(branch, afterEntryId)),
      ),
      selectObservation: Effect.fn("Markers.selectObservation")((branch) =>
        Effect.succeed(
          (() => {
            const latestAdvancingMarker = latestAdvancingMarkerFromBranch(branch);
            const startIndex =
              latestAdvancingMarker === undefined
                ? branch.findIndex(isCapturableMessageEntry)
                : (() => {
                    const observedIndex = branch.findIndex(
                      (entry) => entry.id === latestAdvancingMarker.marker.lastObservedEntryId,
                    );
                    if (observedIndex === -1) {
                      return branch.findIndex(isCapturableMessageEntry);
                    }

                    const markerIndex = branch.findIndex(
                      (entry) => entry.id === latestAdvancingMarker.entry.id,
                    );
                    return markerIndex === -1
                      ? observedIndex + 1
                      : Math.max(observedIndex + 1, markerIndex + 1);
                  })();

            const observedEntries = startIndex === -1 ? [] : branch.slice(startIndex);
            const capturableMessages = observedEntries.filter(isCapturableMessageEntry);

            return {
              latestAdvancingMarker,
              observedEntries,
              capturableMessages,
            } satisfies ObservationSelection;
          })(),
        ),
      ),
    }),
  );
}
