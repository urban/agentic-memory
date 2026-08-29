import { Effect } from "effect";
import { scoreForOutcome } from "./Judge.ts";

type BenchmarkCase = import("./BenchmarkCase.ts").BenchmarkCase;
type Judge = import("./Judge.ts").Judge;
type JudgeFailure = import("./Judge.ts").JudgeFailure;
type JudgeOutcome = import("./Judge.ts").JudgeOutcome;
type RecallObservation = import("./BenchmarkRunner.ts").RecallObservation;

export type HardGateViolation =
  | { readonly _tag: "status"; readonly expected: string; readonly actual: string }
  | { readonly _tag: "forbidden_fact"; readonly fact: string };

export type CaseEvaluation = {
  readonly source: "deterministic" | "judge";
  readonly outcome: JudgeOutcome;
  readonly score: 0 | 0.5 | 1;
  readonly rationale: string;
  readonly hardGateViolations: ReadonlyArray<HardGateViolation>;
};

const normalize = (value: string): string => value.toLowerCase().replaceAll(/\s+/gu, " ").trim();

export const evaluateCase = (input: {
  readonly benchmarkCase: BenchmarkCase;
  readonly observation: RecallObservation;
  readonly judge: Judge;
}): Effect.Effect<CaseEvaluation, JudgeFailure> => {
  const response = input.observation.response;
  const normalizedAnswer = normalize(response.answer);
  const violations: ReadonlyArray<HardGateViolation> = [
    ...(response.status === input.benchmarkCase.expected.status
      ? []
      : [
          {
            _tag: "status" as const,
            expected: input.benchmarkCase.expected.status,
            actual: response.status,
          },
        ]),
    ...input.benchmarkCase.expected.forbiddenFacts
      .filter((fact) => normalizedAnswer.includes(normalize(fact)))
      .map((fact) => ({ _tag: "forbidden_fact" as const, fact })),
  ];
  if (violations.length > 0) {
    return Effect.succeed({
      source: "deterministic",
      outcome: "incorrect",
      score: 0,
      rationale: "Deterministic status or forbidden-fact gate failed.",
      hardGateViolations: violations,
    });
  }
  if (input.benchmarkCase.expected.status === "not_found") {
    return Effect.succeed({
      source: "deterministic",
      outcome: "correct",
      score: 1,
      rationale: "Recall correctly abstained.",
      hardGateViolations: [],
    });
  }
  return input.judge
    .judge({
      question: input.benchmarkCase.question,
      referenceAnswer: input.benchmarkCase.expected.referenceAnswer,
      recallResponse: response,
    })
    .pipe(
      Effect.map((judgment) => ({
        source: "judge" as const,
        outcome: judgment.outcome,
        score: scoreForOutcome(judgment.outcome),
        rationale: judgment.rationale,
        hardGateViolations: [],
      })),
    );
};
