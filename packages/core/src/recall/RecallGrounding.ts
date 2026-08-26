import { Effect, Schema } from "effect";
import { isSafeRecallPublicText } from "./EvidenceSafety.ts";
type RecallEvidencePacket = import("./EvidencePacket.ts").RecallEvidencePacket;
type RecallSynthesisOutput = import("./RecallSynthesis.ts").RecallSynthesisOutput;

export class RecallGroundingError extends Schema.TaggedError<RecallGroundingError>()(
  "RecallGroundingError",
  {
    reason: Schema.Literals([
      "MissingSupportingEvidence",
      "UnknownEvidenceId",
      "UnsupportedClaim",
      "UnsafePublicOutput",
    ]),
    message: Schema.String,
  },
) {}

const normalizeGroundedText = (text: string): string =>
  text
    .replaceAll(/[*_~`]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();

export const validateRecallGrounding = Effect.fnUntraced(function* (
  evidence: RecallEvidencePacket,
  output: RecallSynthesisOutput,
): Effect.fn.Return<RecallSynthesisOutput, RecallGroundingError> {
  if (output.status === "not_found") {
    return output;
  }

  if (output.evidenceIds.length === 0) {
    return yield* RecallGroundingError.make({
      reason: "MissingSupportingEvidence",
      message: "The synthesized answer did not reference supporting evidence",
    });
  }

  const suppliedEvidenceIds = new Set(evidence.passages.map(({ id }) => id));
  if (output.evidenceIds.some((id) => !suppliedEvidenceIds.has(id))) {
    return yield* RecallGroundingError.make({
      reason: "UnknownEvidenceId",
      message: "The synthesized answer referenced evidence outside the supplied packet",
    });
  }

  const citedEvidence = evidence.passages
    .filter(({ id }) => output.evidenceIds.includes(id))
    .map(({ text }) => text)
    .join("\n\n");
  const citedEvidenceText = normalizeGroundedText(citedEvidence);
  const answer = normalizeGroundedText(output.answer);
  const claim = normalizeGroundedText(output.claim);
  if (!citedEvidenceText.includes(answer) || !citedEvidenceText.includes(claim)) {
    return yield* RecallGroundingError.make({
      reason: "UnsupportedClaim",
      message: "The synthesized answer was not quoted from its cited evidence",
    });
  }

  if (
    output.providerModelIdentity === "present" ||
    !isSafeRecallPublicText(output.answer) ||
    !isSafeRecallPublicText(output.claim)
  ) {
    return yield* RecallGroundingError.make({
      reason: "UnsafePublicOutput",
      message: "The synthesized answer contained prohibited internal details",
    });
  }

  return output;
});
