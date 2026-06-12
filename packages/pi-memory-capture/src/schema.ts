import { Schema } from "effect";
import { MARKER_VERSION } from "./constants.ts";

export const NotificationLevel = Schema.Literals(["info", "warning", "error"]).annotate({
  identifier: "NotificationLevel",
});
export type NotificationLevel = typeof NotificationLevel.Type;

export const TriggerKind = Schema.Literals([
  "agent_end",
  "session_before_tree",
  "session_shutdown",
]).annotate({
  identifier: "TriggerKind",
});
export type TriggerKind = typeof TriggerKind.Type;

export const AttemptId = Schema.String.pipe(Schema.brand("AttemptId")).annotate({
  identifier: "AttemptId",
});
export type AttemptId = typeof AttemptId.Type;

export const ProjectLink = Schema.String.check(
  Schema.isPattern(/^\[\[projects\/[a-z0-9][a-z0-9-]*\]\]$/, {
    message: "Expected [[projects/<slug>]]",
  }),
).annotate({
  identifier: "ProjectLink",
});
export type ProjectLink = typeof ProjectLink.Type;

export const UtcIsoTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
    message: "Expected ISO 8601 UTC timestamp ending in Z",
  }),
).annotate({
  identifier: "UtcIsoTimestamp",
});
export type UtcIsoTimestamp = typeof UtcIsoTimestamp.Type;

export const MarkerSummary = Schema.String.check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(50))
  .check(
    Schema.isPattern(/^[A-Z]/, {
      message: "Summary must start with a capital letter",
    }),
  )
  .check(
    Schema.isPattern(/[^.]$/, {
      message: "Summary must not end with a period",
    }),
  )
  .annotate({
    identifier: "MarkerSummary",
  });
export type MarkerSummary = typeof MarkerSummary.Type;

export const ResolvedProjectConfig = Schema.Struct({
  version: Schema.Literal(1),
  vaultPath: Schema.String,
  projectLink: ProjectLink,
}).annotate({
  identifier: "ResolvedProjectConfig",
});
export type ResolvedProjectConfig = typeof ResolvedProjectConfig.Type;

export const LocalPaths = Schema.Struct({
  directory: Schema.String,
  configFile: Schema.String,
}).annotate({
  identifier: "LocalPaths",
});
export type LocalPaths = typeof LocalPaths.Type;

export const LoadConfigResult = Schema.TaggedUnion({
  missing: { paths: LocalPaths },
  invalid: { paths: LocalPaths, message: Schema.String },
  valid: { paths: LocalPaths, config: ResolvedProjectConfig },
}).annotate({
  identifier: "LoadConfigResult",
});
export type LoadConfigResult = typeof LoadConfigResult.Type;

export const PayloadProject = Schema.Struct({
  projectLink: ProjectLink,
  projectLabel: Schema.String,
}).annotate({
  identifier: "PayloadProject",
});
export type PayloadProject = typeof PayloadProject.Type;

export const PayloadObservation = Schema.Struct({
  fromEntryId: Schema.String,
  toEntryId: Schema.String,
  entryCount: Schema.Number,
  messageCount: Schema.Number,
}).annotate({
  identifier: "PayloadObservation",
});
export type PayloadObservation = typeof PayloadObservation.Type;

export const PayloadMessage = Schema.Struct({
  entryId: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
}).annotate({
  identifier: "PayloadMessage",
});
export type PayloadMessage = typeof PayloadMessage.Type;

export const CapturePayload = Schema.Struct({
  version: Schema.Literal(1),
  triggerKind: TriggerKind,
  project: PayloadProject,
  observation: PayloadObservation,
  messages: Schema.Array(PayloadMessage),
}).annotate({
  identifier: "CapturePayload",
});
export type CapturePayload = typeof CapturePayload.Type;

export const StewardResultStatus = Schema.Literals(["captured", "no_changes"]).annotate({
  identifier: "StewardResultStatus",
});
export type StewardResultStatus = typeof StewardResultStatus.Type;

export const StewardResultEnvelope = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("captured"),
    summary: MarkerSummary,
    filesChanged: Schema.optional(Schema.Array(Schema.String)),
    warnings: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    status: Schema.Literal("no_changes"),
    summary: Schema.optional(MarkerSummary),
    filesChanged: Schema.optional(Schema.Array(Schema.String)),
    warnings: Schema.optional(Schema.Array(Schema.String)),
  }),
]).annotate({
  identifier: "StewardResultEnvelope",
});
export type StewardResultEnvelope = typeof StewardResultEnvelope.Type;

export const MarkerEnvelope = Schema.Struct({
  markerVersion: Schema.Literal(MARKER_VERSION),
  attemptId: AttemptId,
  timestamp: UtcIsoTimestamp,
  triggerKind: TriggerKind,
  observation: PayloadObservation,
}).annotate({
  identifier: "MarkerEnvelope",
});
export type MarkerEnvelope = typeof MarkerEnvelope.Type;

export const ObservationResultCapturedMarker = Schema.Struct({
  ...MarkerEnvelope.fields,
  kind: Schema.Literal("observation_result"),
  observationStatus: Schema.Literal("captured"),
  summary: MarkerSummary,
}).annotate({
  identifier: "ObservationResultCapturedMarker",
});
export type ObservationResultCapturedMarker = typeof ObservationResultCapturedMarker.Type;

export const ObservationResultNoChangesMarker = Schema.Struct({
  ...MarkerEnvelope.fields,
  kind: Schema.Literal("observation_result"),
  observationStatus: Schema.Literal("no_changes"),
  summary: Schema.optional(MarkerSummary),
}).annotate({
  identifier: "ObservationResultNoChangesMarker",
});
export type ObservationResultNoChangesMarker = typeof ObservationResultNoChangesMarker.Type;

export const ObservationResultMarker = Schema.Union([
  ObservationResultCapturedMarker,
  ObservationResultNoChangesMarker,
]).annotate({
  identifier: "ObservationResultMarker",
});
export type ObservationResultMarker = typeof ObservationResultMarker.Type;

export const ScheduleResultMarker = Schema.Struct({
  ...MarkerEnvelope.fields,
  kind: Schema.Literal("schedule_result"),
  sendStatus: Schema.Literals(["succeeded", "failed"]),
  retryFailureReasons: Schema.Array(Schema.String),
}).annotate({
  identifier: "ScheduleResultMarker",
});
export type ScheduleResultMarker = typeof ScheduleResultMarker.Type;

export const CaptureMarker = Schema.Union([ObservationResultMarker, ScheduleResultMarker]).annotate(
  {
    identifier: "CaptureMarker",
  },
);
export type CaptureMarker = typeof CaptureMarker.Type;

export const ProjectConfigJson = Schema.fromJsonString(ResolvedProjectConfig);
export const CapturePayloadJson = Schema.fromJsonString(CapturePayload);
export const StewardResultEnvelopeJson = Schema.fromJsonString(StewardResultEnvelope);

export const decodeProjectConfigJson = Schema.decodeUnknownEffect(ProjectConfigJson);
export const encodeProjectConfigJson = Schema.encodeUnknownEffect(ProjectConfigJson);
export const encodeCapturePayloadJson = Schema.encodeUnknownEffect(CapturePayloadJson);
export const decodeStewardResultEnvelopeJson =
  Schema.decodeUnknownEffect(StewardResultEnvelopeJson);
export const decodeCaptureMarkerOption = Schema.decodeUnknownOption(CaptureMarker);
export const decodeAttemptId = Schema.decodeUnknownEffect(AttemptId);
