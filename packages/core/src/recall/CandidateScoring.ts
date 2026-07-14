import { countTokenMatches, countUniqueTokenMatches, tokenSet } from "./RecallText.ts";

type CandidateDraft = import("./RecallModel.ts").CandidateDraft;
type QuestionAnalysis = import("./RecallModel.ts").QuestionAnalysis;
type RecallCandidateOrigin = import("./RecallModel.ts").RecallCandidateOrigin;
type RecallContentStatus = import("./RecallModel.ts").RecallContentStatus;
type RecallLayer = import("./RecallModel.ts").RecallLayer;
type RecallProjectStatus = import("./RecallModel.ts").RecallProjectStatus;

const layerScore = (memoryLayer: RecallLayer): number => {
  switch (memoryLayer) {
    case "note":
      return 14;
    case "project":
      return 12;
    case "user":
      return 12;
    case "record":
      return 8;
    case "map":
      return 5;
    case "core":
      return 3;
    case "person":
      return 2;
    case "source":
      return -5;
  }
};

export const selectedProjectSet = (analysis: QuestionAnalysis): ReadonlySet<string> =>
  new Set(analysis.selectedProjectKeys);

export const candidateHasSelectedProject = (
  analysis: QuestionAnalysis,
  candidate: CandidateDraft,
): boolean => {
  const selectedProjects = selectedProjectSet(analysis);
  if (selectedProjects.size > 0) {
    return candidate.projectKeys.some((projectKey) => selectedProjects.has(projectKey));
  }

  const candidateTokens = tokenSet([...candidate.tokens, ...candidate.metadataTokens]);
  return analysis.selectedEntityTokens.some((entityToken) => candidateTokens.has(entityToken));
};

export const candidateHasCompetingProject = (
  analysis: QuestionAnalysis,
  candidate: CandidateDraft,
): boolean => {
  const selectedProjects = selectedProjectSet(analysis);
  return (
    selectedProjects.size > 0 &&
    candidate.projectKeys.some((projectKey) => !selectedProjects.has(projectKey))
  );
};

export const isAnswerWorthyCandidateText = (
  text: string,
  origin: RecallCandidateOrigin,
): boolean => {
  if (origin === "route") {
    return false;
  }
  const normalized = text.toLowerCase();
  return (
    !normalized.startsWith("read ") &&
    !normalized.startsWith("use this note when") &&
    !normalized.startsWith("do not use") &&
    !normalized.startsWith("none for") &&
    !normalized.startsWith("this fixture") &&
    !normalized.includes("distractor")
  );
};

export const countCandidateTopicMatches = (
  topicTokens: ReadonlyArray<string>,
  candidate: CandidateDraft,
): number =>
  countUniqueTokenMatches(topicTokens, [...candidate.tokens, ...candidate.metadataTokens]);

export const isUserPreferenceCandidate = (candidate: CandidateDraft): boolean =>
  candidate.memoryLayer === "user" ||
  (candidate.memoryLayer === "note" && candidate.projectKeys.length === 0);

const questionMatchedEntityScore = (
  analysis: QuestionAnalysis,
  candidate: CandidateDraft,
): number => {
  if (analysis.selectedProjectKeys.length === 0 && analysis.selectedEntityTokens.length === 0) {
    return 0;
  }

  const hasSelectedProject = candidateHasSelectedProject(analysis, candidate);
  const hasCompetingProject = candidateHasCompetingProject(analysis, candidate);
  const missingSelectedProjectPenalty =
    candidate.projectKeys.length > 0 && !hasSelectedProject ? 22 : 0;

  return (
    (hasSelectedProject ? 36 : 0) - (hasCompetingProject ? 24 : 0) - missingSelectedProjectPenalty
  );
};

const optionApplicabilityScore = (analysis: QuestionAnalysis, candidate: CandidateDraft): number =>
  analysis.wantsOptionPreference &&
  isUserPreferenceCandidate(candidate) &&
  countCandidateTopicMatches(analysis.optionTopicTokens, candidate) > 0
    ? 20
    : 0;

const answerWorthyScore = (candidate: CandidateDraft): number =>
  isAnswerWorthyCandidateText(candidate.text, candidate.origin) ? 4 : -48;

const originScore = (analysis: QuestionAnalysis, candidate: CandidateDraft): number => {
  switch (candidate.origin) {
    case "decision_log":
      return analysis.wantsRationale ? 24 : 14;
    case "resume_context":
      return analysis.wantsResumeContext ? 24 : 10;
    case "map_framing":
      return 6;
    case "summary":
      return 5;
    case "route":
      return -12;
    case "body":
      return analysis.wantsRationale && candidate.memoryLayer === "record" ? 16 : 0;
  }
};

const contentStatusScore = (status: RecallContentStatus | undefined): number => {
  switch (status) {
    case "active":
      return 0;
    case "draft":
      return -16;
    case "stale":
      return -40;
    case "archived":
      return -64;
    case undefined:
      return 0;
  }
};

const projectStatusScore = (
  analysis: QuestionAnalysis,
  projectStatus: RecallProjectStatus | undefined,
): number => {
  if (!analysis.wantsProjectFact) {
    return 0;
  }

  switch (projectStatus) {
    case "active":
      return 0;
    case "candidate":
      return -8;
    case "completed":
      return -16;
    case "archived":
      return -36;
    case undefined:
      return 0;
  }
};

const sourcePolicyScore = (analysis: QuestionAnalysis, candidate: CandidateDraft): number =>
  candidate.memoryLayer !== "source" ? 0 : analysis.wantsSourceEvidence ? 24 : -28;

export const scoreCandidate = (input: {
  readonly analysis: QuestionAnalysis;
  readonly candidate: CandidateDraft;
}): number =>
  countTokenMatches(input.analysis.tokens, input.candidate.tokens) * 3 +
  countUniqueTokenMatches(input.analysis.tokens, input.candidate.tokens) * 5 +
  countUniqueTokenMatches(input.analysis.tokens, input.candidate.metadataTokens) * 4 +
  layerScore(input.candidate.memoryLayer) +
  contentStatusScore(input.candidate.status) +
  projectStatusScore(input.analysis, input.candidate.projectStatus) +
  sourcePolicyScore(input.analysis, input.candidate) +
  originScore(input.analysis, input.candidate) +
  input.candidate.routeBoost +
  questionMatchedEntityScore(input.analysis, input.candidate) +
  optionApplicabilityScore(input.analysis, input.candidate) +
  answerWorthyScore(input.candidate);
