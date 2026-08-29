import { assert, it } from "@effect/vitest";
import { makeBaseline } from "../src/Baseline.ts";
import { makeComparisonResult, renderHumanResult } from "../src/BenchmarkReport.ts";

const benchmarkCase = {
  id: "case",
  fixtureId: "project-memory",
  question: "What is the budget?",
  expected: {
    status: "answered",
    referenceAnswer: "The budget is 200ms p95.",
    forbiddenFacts: [],
  },
} as const;

const observed = (outcome: "correct" | "incorrect") =>
  makeBaseline({
    corpusFingerprint: "sha256:corpus",
    createdAt: outcome === "correct" ? "2026-08-29T00:00:00.000Z" : "2026-08-28T00:00:00.000Z",
    recallRevision: { commit: outcome, dirty: false },
    piVersion: "0.84.3",
    run: {
      score: outcome === "correct" ? 100 : 0,
      metrics: {
        correctCount: outcome === "correct" ? 1 : 0,
        partiallyCorrectCount: 0,
        incorrectCount: outcome === "incorrect" ? 1 : 0,
        statusAccuracy: 100,
        forbiddenFactViolationCount: 0,
        recallLatencyP50Ms: outcome === "correct" ? 10 : 20,
        recallLatencyP95Ms: outcome === "correct" ? 10 : 20,
      },
      cases: [
        {
          benchmarkCase,
          observation: {
            response: {
              status: "answered",
              question: benchmarkCase.question,
              answer: outcome === "correct" ? "Use 200ms p95." : "Unknown.",
              warnings: [],
            },
            durationMs: outcome === "correct" ? 10 : 20,
          },
          evaluation: {
            source: "judge",
            outcome,
            score: outcome === "correct" ? 1 : 0,
            rationale: outcome === "correct" ? "Equivalent." : "Missing the answer.",
            hardGateViolations: [],
          },
        },
      ],
    },
  });

it("reuses baseline evidence and reports every case with directional deltas", () => {
  const baseline = observed("incorrect");
  const baselineBytes = JSON.stringify(baseline);
  const result = makeComparisonResult(baseline, observed("correct"));
  assert.strictEqual(result._tag, "completed_comparison");
  if (result._tag !== "completed_comparison") {
    return;
  }
  assert.strictEqual(result.scoreDelta, 100);
  assert.deepEqual(result.baseline.cases[0]?.evaluation, baseline.cases[0]?.evaluation);
  assert.strictEqual(result.caseDeltas.length, 1);
  assert.include(renderHumanResult(result), "Use 200ms p95.");
  assert.include(renderHumanResult(result), "Missing the answer.");
  assert.strictEqual(JSON.stringify(baseline), baselineBytes);
});
