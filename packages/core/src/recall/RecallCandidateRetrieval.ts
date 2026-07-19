import { Context, Effect, FileSystem, Path } from "effect";

import { readRecallDocuments } from "./RecallDocuments.ts";

type RecallError = import("./RecallContract.ts").RecallError;
type RecallDocument = import("./RecallModel.ts").RecallDocument;

export type RecallCandidateRetrievalRequest = {
  readonly vaultPath: string;
  readonly question: string;
  readonly includeSources: boolean;
};

export type RecallCandidateRetrievalService = {
  readonly retrieve: (
    request: RecallCandidateRetrievalRequest,
  ) => Effect.Effect<ReadonlyArray<RecallDocument>, RecallError, FileSystem.FileSystem | Path.Path>;
};

export class RecallCandidateRetrieval extends Context.Service<
  RecallCandidateRetrieval,
  RecallCandidateRetrievalService
>()("@urban/agentic-memory-core/recall/RecallCandidateRetrieval") {}

export const filesystemRecallCandidateRetrieval = RecallCandidateRetrieval.of({
  retrieve: (request) => readRecallDocuments(request.vaultPath, request.includeSources),
});
