import { Effect, Schema } from "effect";

export const StewardSummary = Schema.String.check(Schema.isMinLength(1))
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
  .annotate({ identifier: "StewardSummary" });
export type StewardSummary = typeof StewardSummary.Type;

const FilesChanged = Schema.Array(Schema.String).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed([])),
);
const Warnings = Schema.Array(Schema.String).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed([])),
);

const DecisionSummary = Schema.String.check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(500))
  .annotate({ identifier: "StewardDecisionSummary" });
const DecisionReason = Schema.String.check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(500))
  .annotate({ identifier: "StewardDecisionReason" });
const DecisionSignal = Schema.String.check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(200))
  .annotate({ identifier: "StewardDecisionSignal" });
const DecisionTarget = Schema.String.check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(200))
  .annotate({ identifier: "StewardDecisionTarget" });

export const StewardDecisionDurability = Schema.Literals([
  "durable",
  "not_durable",
  "duplicate",
  "insufficient_context",
  "uncertain",
]).annotate({ identifier: "StewardDecisionDurability" });
export type StewardDecisionDurability = typeof StewardDecisionDurability.Type;

export const StewardMemoryLayer = Schema.Literals([
  "MEMORY",
  "USER",
  "project",
  "notes",
  "maps",
  "records",
  "people",
  "sources",
]).annotate({ identifier: "StewardMemoryLayer" });
export type StewardMemoryLayer = typeof StewardMemoryLayer.Type;

export const StewardSelectedDestination = Schema.Struct({
  target: DecisionTarget,
  memoryLayer: StewardMemoryLayer,
  reason: DecisionReason,
}).annotate({ identifier: "StewardSelectedDestination" });
export type StewardSelectedDestination = typeof StewardSelectedDestination.Type;

export const StewardSkippedDestination = Schema.Struct({
  memoryLayer: StewardMemoryLayer,
  reason: DecisionReason,
}).annotate({ identifier: "StewardSkippedDestination" });
export type StewardSkippedDestination = typeof StewardSkippedDestination.Type;

export const StewardDecisionReport = Schema.Struct({
  decisionSummary: DecisionSummary,
  durability: StewardDecisionDurability,
  selectedDestinations: Schema.Array(StewardSelectedDestination).check(Schema.isMaxLength(8)),
  skippedDestinations: Schema.Array(StewardSkippedDestination).check(Schema.isMaxLength(8)),
  durableSignals: Schema.Array(DecisionSignal).check(Schema.isMaxLength(5)),
  duplicateSignals: Schema.Array(DecisionSignal).check(Schema.isMaxLength(5)),
  privacyNotes: Schema.Array(DecisionSignal).check(Schema.isMaxLength(5)),
}).annotate({ identifier: "StewardDecisionReport" });
export type StewardDecisionReport = typeof StewardDecisionReport.Type;

export const StewardResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("captured"),
    summary: StewardSummary,
    filesChanged: FilesChanged,
    warnings: Warnings,
    decisionReport: StewardDecisionReport,
  }),
  Schema.Struct({
    status: Schema.Literal("no_changes"),
    summary: Schema.optional(StewardSummary),
    filesChanged: FilesChanged,
    warnings: Warnings,
    decisionReport: StewardDecisionReport,
  }),
]).annotate({ identifier: "StewardResult" });
export type StewardResult = typeof StewardResult.Type;

export const StewardResultStatus = Schema.Literals(["captured", "no_changes"]).annotate({
  identifier: "StewardResultStatus",
});
export type StewardResultStatus = typeof StewardResultStatus.Type;

export const StewardResultJson = Schema.fromJsonString(StewardResult).annotate({
  identifier: "StewardResultJson",
});

export const decodeStewardResult = Schema.decodeUnknownEffect(StewardResult);
export const decodeStewardResultJson = Schema.decodeUnknownEffect(StewardResultJson);
export const encodeStewardResultJson = Schema.encodeUnknownEffect(StewardResultJson);
