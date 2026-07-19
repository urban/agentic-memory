import { Effect, FileSystem, PlatformError, Schema } from "effect";

export const BenchmarkExpectation = Schema.Struct({
  status: Schema.Literals(["answered", "not_found"]),
  answerMustContain: Schema.Array(Schema.String),
  answerMustNotContain: Schema.Array(Schema.String),
}).annotate({ identifier: "BenchmarkExpectation" });
export type BenchmarkExpectation = typeof BenchmarkExpectation.Type;

export const BenchmarkCase = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  includeSources: Schema.optional(Schema.Boolean),
  expected: BenchmarkExpectation,
}).annotate({ identifier: "BenchmarkCase" });
export type BenchmarkCase = typeof BenchmarkCase.Type;

export const BenchmarkCasesJson = Schema.fromJsonString(Schema.Array(BenchmarkCase)).annotate({
  identifier: "BenchmarkCasesJson",
});

const decodeBenchmarkCasesJson = Schema.decodeUnknownEffect(BenchmarkCasesJson, {
  onExcessProperty: "error",
});

export const loadBenchmarkCases = (
  casesPath: string,
): Effect.Effect<
  ReadonlyArray<BenchmarkCase>,
  PlatformError.PlatformError | Schema.SchemaError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const contents = yield* fs.readFileString(casesPath);
    return yield* decodeBenchmarkCasesJson(contents);
  });
