import { Schema } from "effect";
import { MARKER_VERSION, PACKAGE_VERSION } from "./constants.ts";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const NotificationLevel = Schema.Literals(["info", "warning", "error"]).annotate({
  identifier: "NotificationLevel",
});
export type NotificationLevel = typeof NotificationLevel.Type;

export const CaptureCheckpoint = Schema.Literals([
  "manual",
  "session_before_compact",
  "session_shutdown",
  "session_before_tree",
  "session_before_fork",
  "session_before_clone",
]).annotate({
  identifier: "CaptureCheckpoint",
});
export type CaptureCheckpoint = typeof CaptureCheckpoint.Type;

export const CaptureResultStatus = Schema.Literals([
  "captured",
  "no_changes",
  "skipped",
  "failed",
]).annotate({
  identifier: "CaptureResultStatus",
});
export type CaptureResultStatus = typeof CaptureResultStatus.Type;

export const CandidateKind = Schema.Literals([
  "resume_context",
  "project_timeline",
  "project_decision",
  "reusable_note",
  "user_preference",
  "open_question",
]).annotate({
  identifier: "CandidateKind",
});
export type CandidateKind = typeof CandidateKind.Type;

export const CandidateConfidence = Schema.Literals(["low", "medium", "high"]).annotate({
  identifier: "CandidateConfidence",
});
export type CandidateConfidence = typeof CandidateConfidence.Type;

export const CandidateNextAction = Schema.Literals([
  "wait",
  "promote",
  "discard",
  "clarify",
]).annotate({
  identifier: "CandidateNextAction",
});
export type CandidateNextAction = typeof CandidateNextAction.Type;

export const ProjectConfig = Schema.Struct({
  version: Schema.Literal(1),
  vaultPath: Schema.String,
  projectLink: Schema.String,
}).annotate({
  identifier: "ProjectConfig",
});
export type ProjectConfig = typeof ProjectConfig.Type;

export const ScratchpadCandidate = Schema.Struct({
  id: Schema.String,
  kind: CandidateKind,
  summary: Schema.String,
  evidenceCount: Schema.Number,
  firstSeenAt: Schema.String,
  lastSeenAt: Schema.String,
  confidence: CandidateConfidence,
  nextAction: CandidateNextAction,
  reasonNotPromoted: Schema.String,
}).annotate({
  identifier: "ScratchpadCandidate",
});
export type ScratchpadCandidate = typeof ScratchpadCandidate.Type;

export const Scratchpad = Schema.Struct({
  version: Schema.Literal(1),
  projectLink: Schema.String,
  updatedAt: Schema.String,
  pendingCandidates: Schema.Array(ScratchpadCandidate),
}).annotate({
  identifier: "Scratchpad",
});
export type Scratchpad = typeof Scratchpad.Type;

export const PayloadProject = Schema.Struct({
  projectLink: Schema.String,
  projectLabel: Schema.String,
}).annotate({
  identifier: "PayloadProject",
});
export type PayloadProject = typeof PayloadProject.Type;

export const PayloadObservation = Schema.Struct({
  fromEntryId: Schema.String,
  toEntryId: Schema.String,
  entryCount: Schema.Number,
}).annotate({
  identifier: "PayloadObservation",
});
export type PayloadObservation = typeof PayloadObservation.Type;

export const PayloadMessage = Schema.Struct({
  entryId: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  truncated: Schema.Boolean,
}).annotate({
  identifier: "PayloadMessage",
});
export type PayloadMessage = typeof PayloadMessage.Type;

export const CapturePayload = Schema.Struct({
  version: Schema.Literal(1),
  checkpoint: CaptureCheckpoint,
  project: PayloadProject,
  observation: PayloadObservation,
  messages: Schema.Array(PayloadMessage),
  scratchpad: Scratchpad,
}).annotate({
  identifier: "CapturePayload",
});
export type CapturePayload = typeof CapturePayload.Type;

export const CaptureResult = Schema.Struct({
  status: CaptureResultStatus,
  summary: Schema.String,
  filesChanged: Schema.optional(Schema.Array(Schema.String)),
  warnings: Schema.optional(Schema.Array(Schema.String)),
  scratchpad: Schema.optional(Scratchpad),
}).annotate({
  identifier: "CaptureResult",
});
export type CaptureResult = typeof CaptureResult.Type;

export const CaptureResultEnvelope = Schema.Struct({
  status: CaptureResultStatus,
  summary: Schema.String,
  filesChanged: Schema.optional(Schema.Array(Schema.String)),
  warnings: Schema.optional(Schema.Array(Schema.String)),
  scratchpad: Schema.optional(Schema.Unknown),
}).annotate({
  identifier: "CaptureResultEnvelope",
});
export type CaptureResultEnvelope = typeof CaptureResultEnvelope.Type;

const PackageVersion = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(new RegExp(`^${escapeRegExp(PACKAGE_VERSION)}$`), {
      message: `Expected package version ${PACKAGE_VERSION}`,
    }),
  ),
).annotate({
  identifier: "PackageVersion",
});

export const AdvancingCaptureMarker = Schema.Struct({
  version: PackageVersion,
  markerVersion: Schema.Literal(MARKER_VERSION),
  status: Schema.Literals(["captured", "no_changes"]),
  checkpoint: CaptureCheckpoint,
  lastObservedEntryId: Schema.String,
  observation: PayloadObservation,
  timestamp: Schema.String,
  summary: Schema.optional(Schema.String),
}).annotate({
  identifier: "AdvancingCaptureMarker",
});
export type AdvancingCaptureMarker = typeof AdvancingCaptureMarker.Type;

export const NonAdvancingCaptureMarker = Schema.Struct({
  version: PackageVersion,
  markerVersion: Schema.Literal(MARKER_VERSION),
  status: Schema.Literals(["skipped", "failed"]),
  checkpoint: CaptureCheckpoint,
  reason: Schema.String,
  attemptedObservation: Schema.optional(PayloadObservation),
  timestamp: Schema.String,
}).annotate({
  identifier: "NonAdvancingCaptureMarker",
});
export type NonAdvancingCaptureMarker = typeof NonAdvancingCaptureMarker.Type;

export const CaptureMarker = Schema.Union([
  AdvancingCaptureMarker,
  NonAdvancingCaptureMarker,
]).annotate({
  identifier: "CaptureMarker",
});
export type CaptureMarker = typeof CaptureMarker.Type;

export const ProjectConfigJson = Schema.fromJsonString(ProjectConfig);
export const ScratchpadJson = Schema.fromJsonString(Scratchpad);
export const CapturePayloadJson = Schema.fromJsonString(CapturePayload);
export const CaptureResultJson = Schema.fromJsonString(CaptureResult);
export const CaptureResultEnvelopeJson = Schema.fromJsonString(CaptureResultEnvelope);

export const decodeProjectConfigJson = Schema.decodeUnknownEffect(ProjectConfigJson);
export const encodeProjectConfigJson = Schema.encodeUnknownEffect(ProjectConfigJson);
export const decodeScratchpadJson = Schema.decodeUnknownEffect(ScratchpadJson);
export const encodeScratchpadJson = Schema.encodeUnknownEffect(ScratchpadJson);
export const encodeCapturePayloadJson = Schema.encodeUnknownEffect(CapturePayloadJson);
export const decodeCaptureResultJson = Schema.decodeUnknownEffect(CaptureResultJson);
export const decodeCaptureResultEnvelopeJson =
  Schema.decodeUnknownEffect(CaptureResultEnvelopeJson);
export const decodeCaptureMarkerOption = Schema.decodeUnknownOption(CaptureMarker);
export const decodeScratchpadOption = Schema.decodeUnknownOption(Scratchpad);

export interface ResolvedProjectConfig {
  readonly version: 1;
  readonly vaultPath: string;
  readonly projectLink: string;
}

export interface ObservationWindow {
  readonly observedEntries: ReadonlyArray<{ readonly id: string }>;
  readonly latestAdvancingMarker: AdvancingCaptureMarker | undefined;
}
