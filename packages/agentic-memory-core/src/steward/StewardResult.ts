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

export const StewardResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("captured"),
    summary: StewardSummary,
    filesChanged: FilesChanged,
    warnings: Warnings,
  }),
  Schema.Struct({
    status: Schema.Literal("no_changes"),
    summary: Schema.optional(StewardSummary),
    filesChanged: FilesChanged,
    warnings: Warnings,
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
