import { Effect, FileSystem, Path } from "effect";
import { EmbeddingModel } from "../semantic/EmbeddingModel.ts";
import { formatQueryEmbeddingInput } from "../semantic/MarkdownChunking.ts";
import { requireCurrentSemanticIndex, searchSemanticIndex } from "../semantic/SemanticIndex.ts";
import { hydrateSemanticRecallCandidate } from "./EvidenceHydration.ts";
import { prepareRecallEvidencePacket } from "./EvidencePacket.ts";
import { prepareSafeRecallEvidence } from "./EvidenceSafety.ts";
import { isUnsupportedMultipartQuestion } from "./QuestionScope.ts";
import { RecallError } from "./RecallContract.ts";
import { validateRecallGrounding } from "./RecallGrounding.ts";
import { RecallSynthesis } from "./RecallSynthesis.ts";
type RecallRequest = import("./RecallContract.ts").RecallRequest;
type RecallResponse = import("./RecallContract.ts").RecallResponse;
type RecallEvidenceCandidate = import("./EvidencePacket.ts").RecallEvidenceCandidate;
type SemanticIndexError = import("../semantic/SemanticIndex.ts").SemanticIndexError;
type RecallSynthesisError = import("./RecallSynthesis.ts").RecallSynthesisError;

export {
  decodeRecallRequest,
  decodeRecallResponse,
  decodeRecallSuccessJson,
  encodeRecallSuccessJson,
  RecallError,
  RecallRequest,
  RecallResponse,
  RecallSuccessJson,
} from "./RecallContract.ts";

const validateRecallQuestion = (question: string): Effect.Effect<string, RecallError> => {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return Effect.fail(
      RecallError.make({
        reason: "InvalidQuestion",
        message: "Recall question must not be empty or whitespace.",
      }),
    );
  }
  return isUnsupportedMultipartQuestion(trimmed)
    ? Effect.fail(
        RecallError.make({
          reason: "UnsupportedMultipartQuestion",
          message: "Recall supports one factual question at a time; use separate recall commands.",
        }),
      )
    : Effect.succeed(trimmed);
};

const notFoundAnswer = "I don't know based on the available Agentic Memory.";

const toRecallReadinessError = (cause: SemanticIndexError): RecallError => {
  const reason =
    cause.reason === "InvalidVaultPath" ||
    cause.reason === "InvalidVaultStructure" ||
    cause.reason === "IndexReadFailed"
      ? "ReadVaultFailed"
      : cause.reason === "IndexMissing"
        ? "SemanticIndexMissing"
        : cause.reason === "IndexStale"
          ? "SemanticIndexStale"
          : cause.reason === "IndexIncomplete"
            ? "SemanticIndexIncomplete"
            : cause.reason === "InvalidIndex"
              ? "SemanticIndexInvalid"
              : cause.reason === "IncompatibleIndex"
                ? "SemanticIndexIncompatible"
                : "SemanticIndexNotReady";
  return RecallError.make({
    reason,
    message: cause.message,
    cause,
  });
};

const toRecallSynthesisError = (cause: RecallSynthesisError): RecallError => {
  const reason =
    cause.reason === "MissingConfiguration"
      ? "SynthesisConfigurationMissing"
      : cause.reason === "InvalidConfiguration"
        ? "SynthesisConfigurationInvalid"
        : cause.reason === "NonLoopbackEndpoint"
          ? "SynthesisEndpointNotLoopback"
          : cause.reason === "ServerUnavailable"
            ? "SynthesisServerUnavailable"
            : cause.reason === "ServerIncompatible"
              ? "SynthesisServerIncompatible"
              : "SynthesisStructuredOutputFailed";
  return RecallError.make({ reason, message: cause.message, cause });
};

export const recall = Effect.fnUntraced(function* (
  request: RecallRequest,
): Effect.fn.Return<
  RecallResponse,
  RecallError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path | RecallSynthesis
> {
  const question = yield* validateRecallQuestion(request.question);
  yield* requireCurrentSemanticIndex(request.vaultPath).pipe(
    Effect.mapError(toRecallReadinessError),
  );
  const model = yield* EmbeddingModel;
  const queryVectors = yield* model.embed([formatQueryEmbeddingInput(question)]).pipe(
    Effect.mapError((cause) =>
      RecallError.make({
        reason: "QueryEmbeddingFailed",
        message: "Failed to embed the recall question",
        cause,
      }),
    ),
  );
  const query = queryVectors[0];
  if (query === undefined) {
    return yield* RecallError.make({
      reason: "QueryEmbeddingFailed",
      message: "The embedding model omitted the recall question vector",
    });
  }
  const hits = yield* searchSemanticIndex(request.vaultPath, query, 10).pipe(
    Effect.mapError((cause) =>
      RecallError.make({
        reason: "SemanticSearchFailed",
        message: "Failed to search Agentic Memory",
        cause,
      }),
    ),
  );
  yield* requireCurrentSemanticIndex(request.vaultPath).pipe(
    Effect.mapError(toRecallReadinessError),
  );
  const candidates: Array<RecallEvidenceCandidate> = [];
  for (const hit of hits) {
    const hydrated = yield* hydrateSemanticRecallCandidate(request.vaultPath, hit).pipe(
      Effect.mapError((cause) =>
        RecallError.make({
          reason: "EvidenceHydrationFailed",
          message: cause.message,
          cause,
        }),
      ),
    );
    const prepared = prepareSafeRecallEvidence(hydrated);
    if (prepared._tag === "eligible") {
      candidates.push({ documentPath: hit.documentPath, text: prepared.text });
    }
  }
  const packet = prepareRecallEvidencePacket(candidates);
  if (packet.passages.length === 0) {
    return {
      status: "not_found",
      question: request.question,
      answer: notFoundAnswer,
      warnings: [],
    };
  }
  const synthesis = yield* RecallSynthesis;
  const result = yield* synthesis
    .synthesize({ question, evidence: packet })
    .pipe(Effect.mapError(toRecallSynthesisError));
  const grounded = yield* validateRecallGrounding(packet, result).pipe(
    Effect.mapError((cause) =>
      RecallError.make({
        reason: "GroundingValidationFailed",
        message: cause.message,
        cause,
      }),
    ),
  );
  return grounded.status === "answered"
    ? {
        status: "answered",
        question: request.question,
        answer: grounded.answer,
        warnings: [],
      }
    : {
        status: "not_found",
        question: request.question,
        answer: notFoundAnswer,
        warnings: [],
      };
});
