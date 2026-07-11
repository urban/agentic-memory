import {
  candidateHasSelectedProject,
  countCandidateTopicMatches,
  isUserPreferenceCandidate,
} from "./CandidateScoring.ts";
import type { AnswerPart, QuestionAnalysis, RecallCandidate } from "./RecallModel.ts";
import { normalizeForDeduplication } from "./RecallText.ts";

type AnswerCategory = AnswerPart["category"];

const categoryCandidates = (
  analysis: QuestionAnalysis,
  category: AnswerCategory,
  candidates: ReadonlyArray<RecallCandidate>,
): ReadonlyArray<RecallCandidate> =>
  candidates.filter((candidate) => {
    switch (category) {
      case "project_fact":
        return (
          analysis.wantsProjectFact &&
          candidateHasSelectedProject(analysis, candidate) &&
          countCandidateTopicMatches(analysis.projectTopicTokens, candidate) > 0
        );
      case "user_preference":
        return (
          analysis.wantsOptionPreference &&
          isUserPreferenceCandidate(candidate) &&
          countCandidateTopicMatches(analysis.optionTopicTokens, candidate) > 0
        );
    }
  });

const intentQualityScore = (
  analysis: QuestionAnalysis,
  category: AnswerCategory,
  candidate: RecallCandidate,
): number => {
  if (analysis.wantsSourceEvidence) {
    return candidate.memoryLayer === "source" ? 80 : 0;
  }
  if (analysis.wantsRationale) {
    const rationaleTextScore =
      /\b(?:because|matters?|reason|rejected|responsiveness|user-facing)\b/iu.test(candidate.text)
        ? 100
        : 0;
    return (candidate.memoryLayer === "record" ? 60 : 0) + rationaleTextScore;
  }
  if (analysis.wantsResumeContext && candidate.origin === "resume_context") {
    return 100;
  }
  switch (category) {
    case "user_preference":
      return candidate.memoryLayer === "user" ? 50 : candidate.memoryLayer === "note" ? 35 : 0;
    case "project_fact":
      return candidate.origin === "decision_log"
        ? 50
        : candidate.memoryLayer === "note"
          ? 40
          : candidate.memoryLayer === "project"
            ? 30
            : 0;
  }
};

const compareCandidates = (
  analysis: QuestionAnalysis,
  category: AnswerCategory,
  left: RecallCandidate,
  right: RecallCandidate,
): number =>
  intentQualityScore(analysis, category, right) - intentQualityScore(analysis, category, left) ||
  right.score - left.score ||
  left.path.localeCompare(right.path) ||
  left.text.localeCompare(right.text);

const bestByKey = (
  analysis: QuestionAnalysis,
  category: AnswerCategory,
  keyOf: (candidate: RecallCandidate) => string,
  candidates: ReadonlyArray<RecallCandidate>,
): ReadonlyArray<RecallCandidate> =>
  Array.from(
    candidates.reduce((best, candidate) => {
      const key = keyOf(candidate);
      const current = best.get(key);
      return current === undefined || compareCandidates(analysis, category, candidate, current) < 0
        ? new Map(best).set(key, candidate)
        : best;
    }, new Map<string, RecallCandidate>()),
  ).map(([, candidate]) => candidate);

const poolCategory = (
  analysis: QuestionAnalysis,
  category: AnswerCategory,
  candidates: ReadonlyArray<RecallCandidate>,
): ReadonlyArray<RecallCandidate> => {
  const deduplicated = bestByKey(
    analysis,
    category,
    (candidate) => normalizeForDeduplication(candidate.text),
    categoryCandidates(analysis, category, candidates),
  );
  return bestByKey(analysis, category, (candidate) => candidate.path, deduplicated);
};

/** Keeps one candidate per file and requested fact category before answer assembly. */
export const maxPoolCandidatesForAnswer = (input: {
  readonly analysis: QuestionAnalysis;
  readonly rankedCandidates: ReadonlyArray<RecallCandidate>;
}): ReadonlyArray<RecallCandidate> => {
  const categories: ReadonlyArray<AnswerCategory> = ["project_fact", "user_preference"];
  const selected = categories.flatMap((category) =>
    poolCategory(input.analysis, category, input.rankedCandidates),
  );

  return bestByKey(
    input.analysis,
    "project_fact",
    (candidate) => `${candidate.path}\u0000${normalizeForDeduplication(candidate.text)}`,
    selected,
  ).toSorted(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path) ||
      left.text.localeCompare(right.text),
  );
};
