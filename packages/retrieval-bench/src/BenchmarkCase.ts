import { Effect, FileSystem, PlatformError, Schema } from "effect";

export const BenchmarkMode = Schema.Literals(["search", "query"]).annotate({
  identifier: "BenchmarkMode",
});

export type BenchmarkMode = "search" | "query";

export const BenchmarkExpectation = Schema.Struct({
  mustInclude: Schema.Array(Schema.String),
  mustNotInclude: Schema.Array(Schema.String),
  preferredTop1: Schema.optional(Schema.String),
}).annotate({ identifier: "BenchmarkExpectation" });

export type BenchmarkExpectation = {
  readonly mustInclude: ReadonlyArray<string>;
  readonly mustNotInclude: ReadonlyArray<string>;
  readonly preferredTop1?: string | undefined;
};

export const BenchmarkCase = Schema.Struct({
  id: Schema.String,
  mode: BenchmarkMode,
  query: Schema.String,
  projectSlug: Schema.optional(Schema.String),
  includeSources: Schema.optional(Schema.Boolean),
  topK: Schema.optional(Schema.Number),
  expected: BenchmarkExpectation,
}).annotate({ identifier: "BenchmarkCase" });

export type BenchmarkCase = {
  readonly id: string;
  readonly mode: BenchmarkMode;
  readonly query: string;
  readonly projectSlug?: string | undefined;
  readonly includeSources?: boolean | undefined;
  readonly topK?: number | undefined;
  readonly expected: BenchmarkExpectation;
};

export const BenchmarkCasesJson = Schema.fromJsonString(Schema.Array(BenchmarkCase)).annotate({
  identifier: "BenchmarkCasesJson",
});

const decodeBenchmarkCasesJson = Schema.decodeUnknownEffect(BenchmarkCasesJson);

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
