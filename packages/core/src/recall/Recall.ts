import { Effect, FileSystem, Path } from "effect";
import { requireCurrentSemanticIndex } from "../semantic/SemanticIndex.ts";
import {
  filesystemRecallCandidateRetrieval,
  RecallCandidateRetrieval,
} from "./RecallCandidateRetrieval.ts";
import { RecallError } from "./RecallContract.ts";
import { recallValidatedWithCandidateRetrieval, validateRecallQuestion } from "./RecallWorkflow.ts";

type EmbeddingModel = import("../semantic/EmbeddingModel.ts").EmbeddingModel;
type RecallRequest = import("./RecallContract.ts").RecallRequest;
type RecallResponse = import("./RecallContract.ts").RecallResponse;

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

export const recall = Effect.fnUntraced(function* (
  request: RecallRequest,
): Effect.fn.Return<
  RecallResponse,
  RecallError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path
> {
  const question = yield* validateRecallQuestion(request.question);
  yield* requireCurrentSemanticIndex(request.vaultPath).pipe(
    Effect.mapError(
      (cause) =>
        new RecallError({
          reason: "SemanticIndexNotReady",
          message: cause.message,
          cause,
        }),
    ),
  );
  return yield* recallValidatedWithCandidateRetrieval(request, question).pipe(
    Effect.provideService(RecallCandidateRetrieval, filesystemRecallCandidateRetrieval),
  );
});
