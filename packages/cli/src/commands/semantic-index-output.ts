import {
  SemanticIndexReadiness,
  SemanticIndexResult,
} from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { Schema } from "effect";

export const SemanticIndexResultJson = Schema.fromJsonString(SemanticIndexResult).annotate({
  identifier: "SemanticIndexResultJson",
});
export const SemanticIndexReadinessJson = Schema.fromJsonString(SemanticIndexReadiness).annotate({
  identifier: "SemanticIndexReadinessJson",
});

export const encodeSemanticIndexResultJson = Schema.encodeUnknownEffect(SemanticIndexResultJson);
export const decodeSemanticIndexResultJson = Schema.decodeUnknownEffect(SemanticIndexResultJson);
export const encodeSemanticIndexReadinessJson = Schema.encodeUnknownEffect(
  SemanticIndexReadinessJson,
);
export const decodeSemanticIndexReadinessJson = Schema.decodeUnknownEffect(
  SemanticIndexReadinessJson,
);
