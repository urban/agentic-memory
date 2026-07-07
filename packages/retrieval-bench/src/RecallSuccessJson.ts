import { Schema } from "effect";

export const RecallSuccessResponse = Schema.Struct({
  status: Schema.Literal("answered"),
  question: Schema.String,
  answer: Schema.String,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "RecallSuccessResponse" });

export type RecallSuccessResponse = typeof RecallSuccessResponse.Type;

export const RecallSuccessJson = Schema.fromJsonString(RecallSuccessResponse).annotate({
  identifier: "RecallSuccessJson",
});

export const decodeRecallSuccessJson = Schema.decodeUnknownEffect(RecallSuccessJson, {
  onExcessProperty: "error",
});
