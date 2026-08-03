import { Schema } from "effect";
import { SynthesisReadiness } from "../src/recall/SynthesisReadiness.ts";
import { SemanticIndexReadiness } from "../src/semantic/SemanticIndex.ts";

export const SemanticStackProbeVaultStatus = Schema.TaggedStruct("vault", {
  version: Schema.Literal(2),
  status: Schema.Literals(["ready", "not_ready", "invalid"]),
  directory: Schema.String,
  semanticReadiness: SemanticIndexReadiness,
  synthesisReadiness: SynthesisReadiness,
  recallReady: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "SemanticStackProbeVaultStatus" });

const SemanticStackProbeVaultStatusJson = Schema.fromJsonString(
  SemanticStackProbeVaultStatus,
).annotate({ identifier: "SemanticStackProbeVaultStatusJson" });

export const decodeSemanticStackProbeVaultStatus = Schema.decodeUnknownEffect(
  SemanticStackProbeVaultStatusJson,
);
