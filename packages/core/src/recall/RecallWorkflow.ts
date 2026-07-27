import { Effect, FileSystem, Path } from "effect";

import { assembleAnswer, sanitizeGeneratedFields } from "./AnswerAssembly.ts";
import { maxPoolCandidatesForAnswer } from "./CandidatePooling.ts";
import { rankCandidates } from "./CandidateRanking.ts";
import { RecallCandidateRetrieval } from "./RecallCandidateRetrieval.ts";
import { parseRecallDocument } from "./RecallDocuments.ts";
import { RecallError } from "./RecallContract.ts";
import { analyzeQuestion, projectEntitiesFromDocuments } from "./QuestionAnalysis.ts";

type RecallRequest = import("./RecallContract.ts").RecallRequest;
type RecallResponse = import("./RecallContract.ts").RecallResponse;

export const validateRecallQuestion = (question: string): Effect.Effect<string, RecallError> => {
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

export const recallValidatedWithCandidateRetrieval = Effect.fnUntraced(function* (
  request: RecallRequest,
  question: string,
): Effect.fn.Return<
  RecallResponse,
  RecallError,
  FileSystem.FileSystem | Path.Path | RecallCandidateRetrieval
> {
  const candidateRetrieval = yield* RecallCandidateRetrieval;
  const documents = yield* candidateRetrieval.retrieve({
    vaultPath: request.vaultPath,
    question,
    includeSources: request.includeSources,
  });
  const parsedDocuments = documents.map(parseRecallDocument);
  const projectEntities = projectEntitiesFromDocuments(parsedDocuments);
  const analysis = analyzeQuestion(question, projectEntities);
  const rankedCandidates = rankCandidates({
    analysis,
    documents: parsedDocuments,
    projectEntities,
  });
  const pooledCandidates = maxPoolCandidatesForAnswer({ analysis, rankedCandidates });
  const assembled = assembleAnswer({ analysis, rankedCandidates: pooledCandidates });
  const response = {
    status: assembled.status,
    question: request.question,
    answer: assembled.answer,
    warnings: [],
  } satisfies RecallResponse;

  return sanitizeGeneratedFields(response);
});

export const recallWithCandidateRetrieval = Effect.fnUntraced(function* (
  request: RecallRequest,
): Effect.fn.Return<
  RecallResponse,
  RecallError,
  FileSystem.FileSystem | Path.Path | RecallCandidateRetrieval
> {
  const question = yield* validateRecallQuestion(request.question);
  return yield* recallValidatedWithCandidateRetrieval(request, question);
});
