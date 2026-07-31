import { Effect, FileSystem, Path } from "effect";
import { EmbeddingModel } from "../semantic/EmbeddingModel.ts";
import { formatQueryEmbeddingInput } from "../semantic/MarkdownChunking.ts";
import { requireCurrentSemanticIndex, searchSemanticIndex } from "../semantic/SemanticIndex.ts";
import { hydrateSemanticRecallCandidate } from "./EvidenceHydration.ts";
import { prepareRecallEvidencePacket } from "./EvidencePacket.ts";
import { prepareSafeRecallEvidence } from "./EvidenceSafety.ts";
import { RecallError } from "./RecallContract.ts";
type RecallRequest = import("./RecallContract.ts").RecallRequest;
type RecallResponse = import("./RecallContract.ts").RecallResponse;
type RecallEvidenceCandidate = import("./EvidencePacket.ts").RecallEvidenceCandidate;
type SemanticIndexError = import("../semantic/SemanticIndex.ts").SemanticIndexError;

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
  return trimmed.length === 0
    ? Effect.fail(
        new RecallError({
          reason: "InvalidQuestion",
          message: "Recall question must not be empty or whitespace.",
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
  return new RecallError({
    reason,
    message: cause.message,
    cause,
  });
};

export const recall = Effect.fnUntraced(function* (
  request: RecallRequest,
): Effect.fn.Return<
  RecallResponse,
  RecallError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path
> {
  const question = yield* validateRecallQuestion(request.question);
  yield* requireCurrentSemanticIndex(request.vaultPath).pipe(
    Effect.mapError(toRecallReadinessError),
  );
  const model = yield* EmbeddingModel;
  const queryVectors = yield* model.embed([formatQueryEmbeddingInput(question)]).pipe(
    Effect.mapError(
      (cause) =>
        new RecallError({
          reason: "QueryEmbeddingFailed",
          message: "Failed to embed the recall question",
          cause,
        }),
    ),
  );
  const query = queryVectors[0];
  if (query === undefined) {
    return yield* new RecallError({
      reason: "QueryEmbeddingFailed",
      message: "The embedding model omitted the recall question vector",
    });
  }
  const hits = yield* searchSemanticIndex(request.vaultPath, query, 10).pipe(
    Effect.mapError(
      (cause) =>
        new RecallError({
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
      Effect.mapError(
        (cause) =>
          new RecallError({
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
  return {
    status: "answered",
    question: request.question,
    answer: packet.passages.map(({ text }) => text).join("\n\n"),
    warnings: [],
  };
});
