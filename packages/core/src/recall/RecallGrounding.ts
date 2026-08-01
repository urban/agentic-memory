import { Effect, Schema } from "effect";
import { isSafeRecallPublicText } from "./EvidenceSafety.ts";
type RecallEvidencePacket = import("./EvidencePacket.ts").RecallEvidencePacket;
type RecallSynthesisOutput = import("./RecallSynthesis.ts").RecallSynthesisOutput;

export class RecallGroundingError extends Schema.TaggedErrorClass<RecallGroundingError>()(
  "RecallGroundingError",
  {
    reason: Schema.Literals([
      "MissingSupportingEvidence",
      "UnknownEvidenceId",
      "UnsafePublicOutput",
    ]),
    message: Schema.String,
  },
) {}

export const validateRecallGrounding = Effect.fnUntraced(function* (
  evidence: RecallEvidencePacket,
  output: RecallSynthesisOutput,
): Effect.fn.Return<RecallSynthesisOutput, RecallGroundingError> {
  if (output.status === "not_found") return output;

  if (output.evidenceIds.length === 0) {
    return yield* new RecallGroundingError({
      reason: "MissingSupportingEvidence",
      message: "The synthesized answer did not reference supporting evidence",
    });
  }

  const suppliedEvidenceIds = new Set(evidence.passages.map(({ id }) => id));
  if (output.evidenceIds.some((id) => !suppliedEvidenceIds.has(id))) {
    return yield* new RecallGroundingError({
      reason: "UnknownEvidenceId",
      message: "The synthesized answer referenced evidence outside the supplied packet",
    });
  }

  if (
    output.providerModelIdentity === "present" ||
    !isSafeRecallPublicText(output.answer) ||
    !isSafeRecallPublicText(output.claim)
  ) {
    return yield* new RecallGroundingError({
      reason: "UnsafePublicOutput",
      message: "The synthesized answer contained prohibited internal details",
    });
  }

  return output;
});
