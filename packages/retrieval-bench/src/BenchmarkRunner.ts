import { Effect, FileSystem, Path, PlatformError } from "effect";
import { evaluateHardGates } from "./HardGates.ts";

type GateStatus = import("./HardGates.ts").GateStatus;
type HardGateResult = import("./HardGates.ts").HardGateResult;

type RunnerBenchmarkCase = {
  readonly id: string;
  readonly query: string;
  readonly projectSlug?: string | undefined;
  readonly includeSources?: boolean | undefined;
  readonly topK?: number | undefined;
  readonly expected: {
    readonly mustInclude: ReadonlyArray<string>;
    readonly mustNotInclude: ReadonlyArray<string>;
    readonly preferredTop1?: string | undefined;
  };
};

type RunnerRetrievalRequest = {
  readonly vaultPath: string;
  readonly query: string;
  readonly limit: number;
  readonly includeSources: boolean;
  readonly projectSlug?: string;
};

export type RunnerRetrievalResult = {
  readonly path: string;
  readonly memoryLayer: string;
  readonly score: number;
  readonly snippet: string;
};

export type RunnerRetrievalProvider = {
  readonly name: string;
  readonly retrieve: (
    request: RunnerRetrievalRequest,
  ) => Effect.Effect<
    ReadonlyArray<RunnerRetrievalResult>,
    PlatformError.PlatformError,
    FileSystem.FileSystem | Path.Path
  >;
};

export type BenchmarkCaseReport = {
  readonly id: string;
  readonly status: GateStatus;
  readonly provider: string;
  readonly results: ReadonlyArray<RunnerRetrievalResult>;
  readonly hardGates: ReadonlyArray<HardGateResult>;
};

export type BenchmarkSuiteReport = {
  readonly status: GateStatus;
  readonly provider: string;
  readonly cases: ReadonlyArray<BenchmarkCaseReport>;
};

const defaultTopK = 5;

const makeRetrievalRequest = (input: {
  readonly vaultPath: string;
  readonly benchmarkCase: RunnerBenchmarkCase;
}): RunnerRetrievalRequest => {
  const limit = input.benchmarkCase.topK ?? defaultTopK;
  const includeSources = input.benchmarkCase.includeSources === true;

  return input.benchmarkCase.projectSlug === undefined
    ? {
        vaultPath: input.vaultPath,
        query: input.benchmarkCase.query,
        limit,
        includeSources,
      }
    : {
        vaultPath: input.vaultPath,
        query: input.benchmarkCase.query,
        projectSlug: input.benchmarkCase.projectSlug,
        limit,
        includeSources,
      };
};

const makeCaseReport = (input: {
  readonly providerName: string;
  readonly benchmarkCase: RunnerBenchmarkCase;
  readonly results: ReadonlyArray<RunnerRetrievalResult>;
}): BenchmarkCaseReport => {
  const hardGateReport = evaluateHardGates({
    benchmarkCase: input.benchmarkCase,
    results: input.results,
  });

  return {
    id: input.benchmarkCase.id,
    status: hardGateReport.status,
    provider: input.providerName,
    results: input.results,
    hardGates: hardGateReport.gates,
  };
};

export const runBenchmarkCase = (input: {
  readonly provider: RunnerRetrievalProvider;
  readonly vaultPath: string;
  readonly benchmarkCase: RunnerBenchmarkCase;
}): Effect.Effect<
  BenchmarkCaseReport,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  input.provider
    .retrieve(
      makeRetrievalRequest({ vaultPath: input.vaultPath, benchmarkCase: input.benchmarkCase }),
    )
    .pipe(
      Effect.map((results) =>
        makeCaseReport({
          providerName: input.provider.name,
          benchmarkCase: input.benchmarkCase,
          results,
        }),
      ),
    );

export const runBenchmarkSuite = (input: {
  readonly provider: RunnerRetrievalProvider;
  readonly vaultPath: string;
  readonly benchmarkCases: ReadonlyArray<RunnerBenchmarkCase>;
}): Effect.Effect<
  BenchmarkSuiteReport,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.forEach(input.benchmarkCases, (benchmarkCase) =>
    runBenchmarkCase({
      provider: input.provider,
      vaultPath: input.vaultPath,
      benchmarkCase,
    }),
  ).pipe(
    Effect.map((cases) => ({
      status: cases.every((benchmarkCase) => benchmarkCase.status === "pass") ? "pass" : "fail",
      provider: input.provider.name,
      cases,
    })),
  );
