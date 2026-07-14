import {
  candidateHasCompetingProject,
  candidateHasSelectedProject,
  countCandidateTopicMatches,
  isAnswerWorthyCandidateText,
  isUserPreferenceCandidate,
} from "./CandidateScoring.ts";
import {
  cleanMarkup,
  countUniqueTokenMatches,
  normalizeForDeduplication,
  tokenize,
} from "./RecallText.ts";

type RecallResponse = import("./RecallContract.ts").RecallResponse;
type AnswerPart = import("./RecallModel.ts").AnswerPart;
type QuestionAnalysis = import("./RecallModel.ts").QuestionAnalysis;
type RecallCandidate = import("./RecallModel.ts").RecallCandidate;
type SupportedCandidate = import("./RecallModel.ts").SupportedCandidate;

const notFoundAnswer = "I don't know based on the available Agentic Memory.";
const projectSupportFloor = 45;
const optionSupportFloor = 45;
const rationaleContentScore = (analysis: QuestionAnalysis, candidate: RecallCandidate): number =>
  analysis.wantsRationale &&
  /\b(?:because|matters?|reason|rejected|responsiveness|user-facing)\b/iu.test(candidate.text)
    ? 120
    : 0;

const projectFactSupportScore = (analysis: QuestionAnalysis, candidate: RecallCandidate): number =>
  candidate.score +
  rationaleContentScore(analysis, candidate) +
  (candidateHasSelectedProject(analysis, candidate) ? 28 : 0) +
  countCandidateTopicMatches(analysis.projectTopicTokens, candidate) * 14 -
  (candidateHasCompetingProject(analysis, candidate) ? 28 : 0) -
  (isAnswerWorthyCandidateText(candidate.text, candidate.origin) ? 0 : 40);

const isSupportedProjectFactCandidate = (
  analysis: QuestionAnalysis,
  candidate: RecallCandidate,
): boolean =>
  analysis.wantsProjectFact &&
  candidateHasSelectedProject(analysis, candidate) &&
  countCandidateTopicMatches(analysis.projectTopicTokens, candidate) > 0 &&
  (!analysis.wantsSourceEvidence || candidate.memoryLayer === "source") &&
  isAnswerWorthyCandidateText(candidate.text, candidate.origin);

const optionPreferenceSupportScore = (
  analysis: QuestionAnalysis,
  candidate: RecallCandidate,
): number =>
  candidate.score +
  (candidate.memoryLayer === "user" ? 20 : 0) +
  (candidate.memoryLayer === "note" ? 8 : 0) +
  countCandidateTopicMatches(analysis.optionTopicTokens, candidate) * 14 -
  (isAnswerWorthyCandidateText(candidate.text, candidate.origin) ? 0 : 30);

const isSupportedOptionPreferenceCandidate = (
  analysis: QuestionAnalysis,
  candidate: RecallCandidate,
): boolean =>
  analysis.wantsOptionPreference &&
  isUserPreferenceCandidate(candidate) &&
  countCandidateTopicMatches(analysis.optionTopicTokens, candidate) > 0 &&
  isAnswerWorthyCandidateText(candidate.text, candidate.origin);

const bestSupportedCandidate = (input: {
  readonly candidates: ReadonlyArray<RecallCandidate>;
  readonly isSupported: (candidate: RecallCandidate) => boolean;
  readonly supportScore: (candidate: RecallCandidate) => number;
  readonly floor: number;
}): SupportedCandidate | undefined =>
  input.candidates
    .filter(input.isSupported)
    .map((candidate) => ({
      candidate,
      supportScore: input.supportScore(candidate),
    }))
    .filter((supported) => supported.supportScore >= input.floor)
    .toSorted(
      (left, right) =>
        right.supportScore - left.supportScore ||
        right.candidate.score - left.candidate.score ||
        left.candidate.path.localeCompare(right.candidate.path) ||
        left.candidate.text.localeCompare(right.candidate.text),
    )[0];

const bestSentenceForSignals = (
  text: string,
  signals: ReadonlySet<string>,
  requiredFragments: ReadonlyArray<string>,
): string => {
  const sentences = text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => cleanMarkup(sentence))
    .filter((sentence) => sentence.length > 0);

  const rankedSentence = sentences
    .map((sentence) => ({
      sentence,
      score:
        countUniqueTokenMatches(Array.from(signals), tokenize(sentence)) * 6 +
        requiredFragments.filter((fragment) => sentence.toLowerCase().includes(fragment)).length *
          10,
    }))
    .toSorted(
      (left, right) => right.score - left.score || left.sentence.localeCompare(right.sentence),
    )[0];

  return rankedSentence?.sentence ?? cleanMarkup(text);
};

const normalizeAnswerSentence = (sentence: string): string => {
  const normalized = cleanMarkup(sentence)
    .replace(/^(Decision|Explicit):\s*/u, "")
    .replace(/,?\s*for example\b.*$/iu, "")
    .trim();

  if (normalized.length === 0) {
    return normalized;
  }

  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
};

const answerPartSentences = (parts: ReadonlyArray<AnswerPart>): ReadonlyArray<string> =>
  Array.from(
    parts.reduce((sentences, part) => {
      const normalized = normalizeForDeduplication(part.sentence);
      return normalized.length === 0 || sentences.has(normalized)
        ? sentences
        : new Map(sentences).set(normalized, part.sentence);
    }, new Map<string, string>()),
  ).map(([, sentence]) => sentence);

export const assembleAnswer = (input: {
  readonly analysis: QuestionAnalysis;
  readonly rankedCandidates: ReadonlyArray<RecallCandidate>;
}): { readonly status: RecallResponse["status"]; readonly answer: string } => {
  const projectCandidate = bestSupportedCandidate({
    candidates: input.rankedCandidates,
    floor: projectSupportFloor,
    isSupported: (candidate) => isSupportedProjectFactCandidate(input.analysis, candidate),
    supportScore: (candidate) => projectFactSupportScore(input.analysis, candidate),
  });
  const optionCandidate = bestSupportedCandidate({
    candidates: input.rankedCandidates,
    floor: optionSupportFloor,
    isSupported: (candidate) => isSupportedOptionPreferenceCandidate(input.analysis, candidate),
    supportScore: (candidate) => optionPreferenceSupportScore(input.analysis, candidate),
  });
  const projectParts: ReadonlyArray<AnswerPart> =
    projectCandidate === undefined
      ? []
      : [
          {
            category: "project_fact",
            sentence: normalizeAnswerSentence(
              bestSentenceForSignals(
                projectCandidate.candidate.text,
                new Set(input.analysis.projectTopicTokens),
                input.analysis.wantsRationale
                  ? ["user-facing", "responsiveness", "mattered because"]
                  : [],
              ),
            ),
          },
        ];
  const optionParts: ReadonlyArray<AnswerPart> =
    optionCandidate === undefined
      ? []
      : [
          {
            category: "user_preference",
            sentence: normalizeAnswerSentence(
              bestSentenceForSignals(
                optionCandidate.candidate.text,
                new Set(input.analysis.optionTopicTokens),
                [],
              ),
            ),
          },
        ];
  const parts = [...projectParts, ...optionParts];
  const sentences = answerPartSentences(parts);

  return sentences.length === 0
    ? {
        answer: notFoundAnswer,
        status: "not_found",
      }
    : {
        answer: sentences.join(" "),
        status: "answered",
      };
};

export const sanitizeGeneratedFields = (response: RecallResponse): RecallResponse => ({
  ...response,
  answer: cleanMarkup(response.answer),
  warnings: response.warnings.map(cleanMarkup),
});
