import { Schema } from "effect";

const RecallWarnings = Schema.Array(Schema.String).annotate({
  identifier: "RecallWarnings",
});

export const RecallRequest = Schema.Struct({
  vaultPath: Schema.String,
  question: Schema.String,
}).annotate({ identifier: "RecallRequest" });
export type RecallRequest = typeof RecallRequest.Type;

export const RecallResponse = Schema.Struct({
  status: Schema.Literals(["answered", "not_found"]),
  question: Schema.String,
  answer: Schema.String,
  warnings: RecallWarnings,
}).annotate({ identifier: "RecallResponse" });
export type RecallResponse = typeof RecallResponse.Type;

export const RecallSuccessJson = Schema.fromJsonString(RecallResponse).annotate({
  identifier: "RecallSuccessJson",
});

export const decodeRecallRequest = Schema.decodeUnknownEffect(RecallRequest, {
  onExcessProperty: "error",
});
export const decodeRecallResponse = Schema.decodeUnknownEffect(RecallResponse, {
  onExcessProperty: "error",
});
export const decodeRecallSuccessJson = Schema.decodeUnknownEffect(RecallSuccessJson, {
  onExcessProperty: "error",
});
export const encodeRecallSuccessJson = Schema.encodeUnknownEffect(RecallSuccessJson, {
  onExcessProperty: "error",
});

export class RecallError extends Schema.TaggedErrorClass<RecallError>()("RecallError", {
  reason: Schema.Literals([
    "InvalidQuestion",
    "ReadVaultFailed",
    "SemanticIndexMissing",
    "SemanticIndexStale",
    "SemanticIndexIncomplete",
    "SemanticIndexInvalid",
    "SemanticIndexIncompatible",
    "SemanticIndexNotReady",
    "QueryEmbeddingFailed",
    "SemanticSearchFailed",
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
