import { Effect } from "effect";
import { evaluateCase } from "./Evaluation.ts";
import { RecallSubjectFailure } from "./BenchmarkRunner.ts";

type BenchmarkCase = import("./BenchmarkCase.ts").BenchmarkCase;
type RecallObservation = import("./BenchmarkRunner.ts").RecallObservation;
type RecallSubject = import("./BenchmarkRunner.ts").RecallSubject;
type CaseEvaluation = import("./Evaluation.ts").CaseEvaluation;
type Judge = import("./Judge.ts").Judge;
type JudgeFailure = import("./Judge.ts").JudgeFailure;

export type ScoredCase = {
  readonly benchmarkCase: BenchmarkCase;
  readonly observation: RecallObservation;
  readonly evaluation: CaseEvaluation;
};

export type RunMetrics = {
  readonly correctCount: number;
  readonly partiallyCorrectCount: number;
  readonly incorrectCount: number;
  readonly statusAccuracy: number;
  readonly forbiddenFactViolationCount: number;
  readonly recallLatencyP50Ms: number;
  readonly recallLatencyP95Ms: number;
};

export type ScoredRun = {
  readonly score: number;
  readonly metrics: RunMetrics;
  readonly cases: ReadonlyArray<ScoredCase>;
};

const percentile = (percent: number, values: ReadonlyArray<number>): number => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percent * sorted.length) - 1)] ?? 0;
};

export const aggregateScoredCases = (cases: ReadonlyArray<ScoredCase>): ScoredRun => {
  const count = cases.length;
  const durations = cases.map(({ observation }) => observation.durationMs);
  return {
    score:
      count === 0 ? 0 : (cases.reduce((sum, item) => sum + item.evaluation.score, 0) / count) * 100,
    metrics: {
      correctCount: cases.filter(({ evaluation }) => evaluation.outcome === "correct").length,
      partiallyCorrectCount: cases.filter(
        ({ evaluation }) => evaluation.outcome === "partially_correct",
      ).length,
      incorrectCount: cases.filter(({ evaluation }) => evaluation.outcome === "incorrect").length,
      statusAccuracy:
        count === 0
          ? 0
          : (cases.filter(
              ({ benchmarkCase, observation }) =>
                benchmarkCase.expected.status === observation.response.status,
            ).length /
              count) *
            100,
      forbiddenFactViolationCount: cases.reduce(
        (sum, item) =>
          sum +
          item.evaluation.hardGateViolations.filter(
            (violation) => violation._tag === "forbidden_fact",
          ).length,
        0,
      ),
      recallLatencyP50Ms: percentile(0.5, durations),
      recallLatencyP95Ms: percentile(0.95, durations),
    },
    cases,
  };
};

export const runScoredSuite = (input: {
  readonly cases: ReadonlyArray<BenchmarkCase>;
  readonly fixtureVaults: ReadonlyMap<string, string>;
  readonly subject: RecallSubject;
  readonly judge: Judge;
}): Effect.Effect<ScoredRun, RecallSubjectFailure | JudgeFailure> =>
  Effect.forEach(input.cases, (benchmarkCase) => {
    const vaultPath = input.fixtureVaults.get(benchmarkCase.fixtureId);
    return vaultPath === undefined
      ? Effect.fail(
          RecallSubjectFailure.make({
            reason: "process",
            message: `Prepared fixture missing: ${benchmarkCase.fixtureId}`,
          }),
        )
      : input.subject
          .run({ question: benchmarkCase.question, vaultPath })
          .pipe(
            Effect.flatMap((observation) =>
              evaluateCase({ benchmarkCase, observation, judge: input.judge }).pipe(
                Effect.map((evaluation) => ({ benchmarkCase, observation, evaluation })),
              ),
            ),
          );
  }).pipe(Effect.map(aggregateScoredCases));
