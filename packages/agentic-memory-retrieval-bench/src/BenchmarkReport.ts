import { Schema } from "effect";
import { CanonicalBaseline } from "./Baseline.ts";

const CaseDelta = Schema.Struct({ id: Schema.String, scoreDelta: Schema.Finite });
export const CompletedUpdate = Schema.TaggedStruct("completed_update", {
  destination: Schema.String,
  hardGateFailed: Schema.Boolean,
  baseline: CanonicalBaseline,
});
export const CompletedComparison = Schema.TaggedStruct("completed_comparison", {
  hardGateFailed: Schema.Boolean,
  scoreDelta: Schema.Finite,
  caseDeltas: Schema.Array(CaseDelta),
  baseline: CanonicalBaseline,
  newRun: CanonicalBaseline,
});
export const InvalidRun = Schema.TaggedStruct("invalid_run", {
  stage: Schema.String,
  errorTag: Schema.String,
  message: Schema.String,
  guidance: Schema.String,
});
export const InvalidArguments = Schema.TaggedStruct("invalid_arguments", {
  message: Schema.String,
  usage: Schema.String,
});
export const BenchmarkResult = Schema.Union([
  CompletedUpdate,
  CompletedComparison,
  InvalidRun,
  InvalidArguments,
]);
export type BenchmarkResult = typeof BenchmarkResult.Type;
const BenchmarkResultJson = Schema.fromJsonString(BenchmarkResult);
export const encodeBenchmarkResultJson = Schema.encodeEffect(BenchmarkResultJson);
export const decodeBenchmarkResultJson = Schema.decodeUnknownEffect(BenchmarkResultJson, {
  onExcessProperty: "error",
});

export const hasHardGateFailures = (baseline: CanonicalBaseline): boolean =>
  baseline.cases.some((item) => item.evaluation.hardGateViolations.length > 0);

export const makeComparisonResult = (
  baseline: CanonicalBaseline,
  newRun: CanonicalBaseline,
): BenchmarkResult => ({
  _tag: "completed_comparison",
  hardGateFailed: hasHardGateFailures(newRun),
  scoreDelta: newRun.score - baseline.score,
  caseDeltas: newRun.cases.map((item, index) => ({
    id: item.benchmarkCase.id,
    scoreDelta: item.evaluation.score - (baseline.cases[index]?.evaluation.score ?? 0),
  })),
  baseline,
  newRun,
});

export const renderHumanResult = (result: BenchmarkResult): string => {
  if (result._tag === "invalid_arguments") {
    return `${result.message}\n${result.usage}`;
  }
  if (result._tag === "invalid_run") {
    return `${result.stage}: ${result.message}\n${result.guidance}`;
  }
  if (result._tag === "completed_update") {
    return [
      `Agentic Memory Recall benchmark baseline updated: ${result.baseline.score.toFixed(2)}%`,
      `Cases: ${result.baseline.cases.length}`,
      `Destination: ${result.destination}`,
      ...result.baseline.cases.map(
        (item) =>
          `${item.benchmarkCase.id}: ${item.evaluation.outcome} (${item.evaluation.score}) — ${item.response.answer}`,
      ),
    ].join("\n");
  }
  return [
    `Agentic Memory Recall benchmark comparison: ${result.baseline.score.toFixed(2)}% → ${result.newRun.score.toFixed(2)}% (${result.scoreDelta >= 0 ? "+" : ""}${result.scoreDelta.toFixed(2)} pp)`,
    ...result.newRun.cases.flatMap((item, index) => {
      const previous = result.baseline.cases[index];
      return [
        `${item.benchmarkCase.id}: ${(result.caseDeltas[index]?.scoreDelta ?? 0).toFixed(1)}`,
        `  question: ${item.benchmarkCase.question}`,
        ...(item.benchmarkCase.expected.status === "answered"
          ? [`  reference: ${item.benchmarkCase.expected.referenceAnswer}`]
          : []),
        `  baseline: ${previous?.response.answer ?? "missing"} — ${previous?.evaluation.outcome ?? "missing"} — ${previous?.evaluation.rationale ?? "missing"}`,
        `  new: ${item.response.answer} — ${item.evaluation.outcome} — ${item.evaluation.rationale}`,
        `  durations: ${previous?.durationMs ?? 0}ms → ${item.durationMs}ms`,
      ];
    }),
  ].join("\n");
};
