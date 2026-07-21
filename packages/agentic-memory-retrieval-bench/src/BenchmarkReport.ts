import { Schema } from "effect";

export const BenchmarkStatus = Schema.Literals(["pass", "fail"]).annotate({
  identifier: "BenchmarkStatus",
});
export type BenchmarkStatus = typeof BenchmarkStatus.Type;

export const BenchmarkHardGateName = Schema.Literals([
  "exitCode",
  "stdoutJson",
  "status",
  "answerMustContain",
  "answerMustNotContain",
]).annotate({ identifier: "BenchmarkHardGateName" });
export type BenchmarkHardGateName = typeof BenchmarkHardGateName.Type;

export const BenchmarkRecallStatus = Schema.Literals(["answered", "not_found"]).annotate({
  identifier: "BenchmarkRecallStatus",
});

export const BenchmarkCaseResult = Schema.Struct({
  id: Schema.String,
  status: BenchmarkStatus,
  durationMs: Schema.Finite,
  failedGates: Schema.Array(BenchmarkHardGateName),
  requiredFactsMissing: Schema.Array(Schema.String),
  forbiddenFactsPresent: Schema.Array(Schema.String),
  command: Schema.Array(Schema.String),
  recallStatus: Schema.optional(BenchmarkRecallStatus),
}).annotate({ identifier: "BenchmarkCaseResult" });

export const BenchmarkLatency = Schema.Struct({
  p50Ms: Schema.Finite,
  p95Ms: Schema.Finite,
}).annotate({ identifier: "BenchmarkLatency" });

export const BenchmarkSuiteResult = Schema.Struct({
  status: BenchmarkStatus,
  runner: Schema.String,
  caseCount: Schema.Finite,
  passCount: Schema.Finite,
  failCount: Schema.Finite,
  latency: BenchmarkLatency,
  cases: Schema.Array(BenchmarkCaseResult),
}).annotate({ identifier: "BenchmarkSuiteResult" });

export type BenchmarkSuiteResult = typeof BenchmarkSuiteResult.Type;

export const BenchmarkSuiteResultJson = Schema.fromJsonString(BenchmarkSuiteResult).annotate({
  identifier: "BenchmarkSuiteResultJson",
});

export const decodeBenchmarkSuiteResultJson = Schema.decodeUnknownEffect(BenchmarkSuiteResultJson, {
  onExcessProperty: "error",
});

export const encodeBenchmarkSuiteResultJson = Schema.encodeUnknownEffect(BenchmarkSuiteResultJson);
