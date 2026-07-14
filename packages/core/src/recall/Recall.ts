import { Effect, FileSystem, Path } from "effect";

import {
  filesystemRecallCandidateRetrieval,
  RecallCandidateRetrieval,
} from "./RecallCandidateRetrieval.ts";
import { recallWithCandidateRetrieval } from "./RecallWorkflow.ts";

type RecallError = import("./RecallContract.ts").RecallError;
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

export const recall = (
  request: RecallRequest,
): Effect.Effect<RecallResponse, RecallError, FileSystem.FileSystem | Path.Path> =>
  recallWithCandidateRetrieval(request).pipe(
    Effect.provideService(RecallCandidateRetrieval, filesystemRecallCandidateRetrieval),
  );
