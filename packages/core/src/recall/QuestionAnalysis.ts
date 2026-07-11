import { titleFromPath } from "./RecallDocuments.ts";
import type { ParsedRecallDocument, ProjectEntity, QuestionAnalysis } from "./RecallModel.ts";
import { tokenize, tokenSet, uniqueStrings } from "./RecallText.ts";

const genericEntityTokens = new Set([
  "active",
  "budget",
  "decision",
  "latency",
  "map",
  "memory",
  "note",
  "policy",
  "record",
  "retry",
  "scheduler",
  "source",
]);

const sourceEvidenceQuestionSignals = new Set([
  "evidence",
  "provenance",
  "raw",
  "source",
  "verification",
  "verify",
]);

const optionQuestionSignals = new Set([
  "capital",
  "choice",
  "direction",
  "format",
  "letter",
  "option",
  "present",
  "presentation",
  "prioritization",
  "prioritize",
  "priority",
  "rank",
  "reply",
  "stack",
]);

const rationaleQuestionSignals = new Set(["history", "historical", "rationale", "reason", "why"]);

const resumeQuestionSignals = new Set(["before", "context", "matter", "resume", "resuming"]);

const projectQuestionSignals = new Set([
  "backoff",
  "batch",
  "budget",
  "latency",
  "policy",
  "responsiveness",
  "retry",
  "scheduler",
  "throughput",
  "timing",
  "window",
]);

const genericQuestionEntityTokens = new Set([
  "ask",
  "answer",
  "available",
  "based",
  "choose",
  "chose",
  "follow",
  "know",
  "launch",
  "morning",
  "setting",
  "tomorrow",
  "tune",
  "use",
]);

const projectKeyFromPath = (relativePath: string): string | undefined => {
  const prefix = "projects/";
  const suffix = ".md";
  return relativePath.startsWith(prefix) && relativePath.endsWith(suffix)
    ? relativePath.slice(prefix.length, -suffix.length)
    : undefined;
};

const projectEntityFromDocument = (document: ParsedRecallDocument): ProjectEntity | undefined => {
  const key = projectKeyFromPath(document.path);
  if (key === undefined) {
    return undefined;
  }

  const labels = uniqueStrings([document.title, ...document.aliases, titleFromPath(document.path)]);
  const labelTokenSets = labels.map(tokenize).filter((tokens) => tokens.length > 0);
  const distinctiveTokens = uniqueStrings(
    labelTokenSets.flatMap((tokens) =>
      tokens.filter(
        (token) => !genericEntityTokens.has(token) && !projectQuestionSignals.has(token),
      ),
    ),
  );
  return {
    distinctiveTokens,
    key,
    labelTokenSets,
  };
};

export const projectEntitiesFromDocuments = (
  documents: ReadonlyArray<ParsedRecallDocument>,
): ReadonlyArray<ProjectEntity> =>
  documents
    .filter((document) => document.memoryLayer === "project")
    .flatMap((document) => {
      const entity = projectEntityFromDocument(document);
      return entity === undefined ? [] : [entity];
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));

const hasExactProjectLabel = (entity: ProjectEntity, tokens: ReadonlySet<string>): boolean =>
  entity.labelTokenSets.some(
    (labelTokens) =>
      labelTokens.length > 0 && labelTokens.every((labelToken) => tokens.has(labelToken)),
  );

const uniqueEntityTokens = (projectEntities: ReadonlyArray<ProjectEntity>): ReadonlySet<string> => {
  const tokenCounts = projectEntities
    .flatMap((entity) => uniqueStrings(entity.distinctiveTokens))
    .reduce(
      (counts, token) => counts.set(token, (counts.get(token) ?? 0) + 1),
      new Map<string, number>(),
    );

  return new Set(
    Array.from(tokenCounts.entries())
      .filter(([, count]) => count === 1)
      .map(([token]) => token),
  );
};

export const detectProjectKeys = (
  text: string,
  projectEntities: ReadonlyArray<ProjectEntity>,
): ReadonlyArray<string> => {
  const tokens = tokenSet(tokenize(text));
  const exactMatches = projectEntities.filter((entity) => hasExactProjectLabel(entity, tokens));
  if (exactMatches.length > 0) {
    return exactMatches.map((entity) => entity.key);
  }

  const uniqueTokens = uniqueEntityTokens(projectEntities);
  return projectEntities
    .filter((entity) =>
      entity.distinctiveTokens.some(
        (distinctiveToken) => uniqueTokens.has(distinctiveToken) && tokens.has(distinctiveToken),
      ),
    )
    .map((entity) => entity.key);
};

const questionEntityTokens = (tokens: ReadonlyArray<string>): ReadonlyArray<string> =>
  uniqueStrings(
    tokens.filter(
      (token) =>
        !projectQuestionSignals.has(token) &&
        !optionQuestionSignals.has(token) &&
        !genericEntityTokens.has(token) &&
        !genericQuestionEntityTokens.has(token),
    ),
  );

export const analyzeQuestion = (
  question: string,
  projectEntities: ReadonlyArray<ProjectEntity>,
): QuestionAnalysis => {
  const tokens = tokenize(question);
  const questionTokenSet = tokenSet(tokens);
  const selectedProjectKeys = detectProjectKeys(question, projectEntities);
  const selectedProjectKeySet = new Set(selectedProjectKeys);
  const matchedProjectEntityTokens = uniqueStrings(
    projectEntities
      .filter((entity) => selectedProjectKeySet.has(entity.key))
      .flatMap((entity) => [...entity.labelTokenSets.flat(), ...entity.distinctiveTokens])
      .filter((token) => questionTokenSet.has(token)),
  );
  const selectedEntityTokens =
    matchedProjectEntityTokens.length > 0
      ? matchedProjectEntityTokens
      : questionEntityTokens(tokens);
  const projectTopicTokens = uniqueStrings(
    tokens.filter(
      (token) =>
        !selectedEntityTokens.includes(token) &&
        !optionQuestionSignals.has(token) &&
        !genericQuestionEntityTokens.has(token),
    ),
  );
  const optionTopicTokens = uniqueStrings(
    tokens.filter((token) => optionQuestionSignals.has(token)),
  );
  const hasNamedEntity = selectedProjectKeys.length > 0 || selectedEntityTokens.length > 0;
  const wantsProjectFact = hasNamedEntity && projectTopicTokens.length > 0;
  const wantsOptionPreference = optionTopicTokens.length > 0;
  const wantsSourceEvidence = tokens.some((token) => sourceEvidenceQuestionSignals.has(token));
  const wantsRationale = tokens.some((token) => rationaleQuestionSignals.has(token));
  const wantsResumeContext = tokens.some((token) => resumeQuestionSignals.has(token));

  return {
    optionTopicTokens,
    projectTopicTokens,
    selectedEntityTokens,
    selectedProjectKeys,
    tokens,
    wantsOptionPreference,
    wantsProjectFact,
    wantsRationale,
    wantsResumeContext,
    wantsSourceEvidence,
  };
};
