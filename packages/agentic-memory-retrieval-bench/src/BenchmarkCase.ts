import { Effect, FileSystem, PlatformError, Schema } from "effect";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

export const AnsweredExpectation = Schema.Struct({
  status: Schema.Literal("answered"),
  referenceAnswer: NonEmptyString,
  forbiddenFacts: Schema.Array(NonEmptyString),
});

export const NotFoundExpectation = Schema.Struct({
  status: Schema.Literal("not_found"),
  forbiddenFacts: Schema.Array(NonEmptyString),
});

export const BenchmarkExpectation = Schema.Union([AnsweredExpectation, NotFoundExpectation]);
export type BenchmarkExpectation = typeof BenchmarkExpectation.Type;

export const BenchmarkCase = Schema.Struct({
  id: NonEmptyString,
  fixtureId: Schema.Literals(["project-memory", "user-preferences"]),
  question: NonEmptyString,
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
