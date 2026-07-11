import { Effect, FileSystem, Path } from "effect";

import { assembleAnswer, sanitizeGeneratedFields } from "./AnswerAssembly.ts";
import { rankCandidates } from "./CandidateRanking.ts";
import { parseRecallDocument, readRecallDocuments } from "./RecallDocuments.ts";
import { RecallError } from "./RecallContract.ts";
import type { RecallRequest, RecallResponse } from "./RecallContract.ts";
import { analyzeQuestion, projectEntitiesFromDocuments } from "./QuestionAnalysis.ts";

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
): Effect.fn.Return<RecallResponse, RecallError, FileSystem.FileSystem | Path.Path> {
  const question = request.question.trim();
  if (question.length === 0) {
    return yield* new RecallError({
      reason: "InvalidQuestion",
      message: "Recall question must not be empty or whitespace.",
    });
  }

  const documents = yield* readRecallDocuments(request.vaultPath, request.includeSources);
  const parsedDocuments = documents.map(parseRecallDocument);
  const projectEntities = projectEntitiesFromDocuments(parsedDocuments);
  const analysis = analyzeQuestion(question, projectEntities);
  const rankedCandidates = rankCandidates({
    analysis,
    documents: parsedDocuments,
    projectEntities,
  });
  const assembled = assembleAnswer({ analysis, rankedCandidates });
  const response = {
    status: assembled.status,
    question: request.question,
    answer: assembled.answer,
    warnings: [],
  } satisfies RecallResponse;

  return sanitizeGeneratedFields(response);
});
