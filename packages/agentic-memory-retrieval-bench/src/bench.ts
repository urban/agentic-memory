#!/usr/bin/env bun

import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, DateTime, Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import {
  corpusFingerprint,
  decodeBaselineJson,
  judgeFingerprint,
  makeBaseline,
  writeBaselineAtomically,
} from "./Baseline.ts";
import { loadCanonicalSuite } from "./BenchmarkManifest.ts";
import {
  encodeBenchmarkResultJson,
  hasHardGateFailures,
  makeComparisonResult,
  renderHumanResult,
} from "./BenchmarkReport.ts";
import {
  makePublicCliRecallSubject,
  runAgenticMemoryCli,
  runBenchmarkProcess,
} from "./BenchmarkRunner.ts";
import { fixtureVaultMap, prepareCanonicalFixtures } from "./FixturePreparation.ts";
import { makePiJudge } from "./Judge.ts";
import { runScoredSuite } from "./ScoredRun.ts";

type BenchmarkResult = import("./BenchmarkReport.ts").BenchmarkResult;

type BenchOptions = { readonly json: boolean; readonly update: boolean };
type ParsedArguments =
  | { readonly _tag: "valid"; readonly options: BenchOptions }
  | { readonly _tag: "help" }
  | { readonly _tag: "invalid"; readonly message: string };

export const usage = [
  "Usage: bun run bench [--update] [--json] [--help]",
  "",
  "Runs the complete canonical Recall suite. The default compares with the canonical baseline.",
].join("\n");

export const parseArguments = (args: ReadonlyArray<string>): ParsedArguments => {
  const parse = (remaining: ReadonlyArray<string>, options: BenchOptions): ParsedArguments => {
    const [argument, ...rest] = remaining;
    if (argument === undefined) {
      return { _tag: "valid", options };
    }
    if (argument === "--help" || argument === "-h") {
      return { _tag: "help" };
    }
    if (argument === "--json") {
      return parse(rest, { ...options, json: true });
    }
    if (argument === "--update") {
      return parse(rest, { ...options, update: true });
    }
    return { _tag: "invalid", message: `Unsupported benchmark argument: ${argument}` };
  };
  return parse(args, { json: false, update: false });
};

export class BenchmarkWorkflowFailure extends Schema.TaggedError<BenchmarkWorkflowFailure>()(
  "BenchmarkWorkflowFailure",
  { stage: Schema.String, message: Schema.String, guidance: Schema.String },
) {}

const requireSuccessfulCommand = (
  stage: string,
  execution: { readonly exitCode: number; readonly stderr: string },
) =>
  execution.exitCode === 0
    ? Effect.void
    : Effect.fail(
        BenchmarkWorkflowFailure.make({
          stage,
          message: execution.stderr.trim() || `${stage} command failed.`,
          guidance: "Resolve the reported operational failure and rerun the complete suite.",
        }),
      );

const prepareFixture = Effect.fn("Benchmark.prepareFixture")(function* (fixture: {
  readonly overlayPath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix: "agentic-memory-recall-bench-" });
  const initialized = yield* runAgenticMemoryCli(["init", vaultPath, "--yes", "--json"]);
  yield* requireSuccessfulCommand("fixture_init", initialized);
  yield* fs.copy(fixture.overlayPath, vaultPath, { overwrite: true });
  const indexed = yield* runAgenticMemoryCli(["index", "--vault", vaultPath, "--json"]);
  yield* requireSuccessfulCommand("fixture_index", indexed);
  return vaultPath;
});

const readCompatibleBaseline = Effect.fn("Benchmark.readCompatibleBaseline")(function* (
  baselinePath: string,
  expectedCorpusFingerprint: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const baseline = yield* fs.readFileString(baselinePath).pipe(
    Effect.flatMap(decodeBaselineJson),
    Effect.mapError((error) =>
      BenchmarkWorkflowFailure.make({
        stage: "baseline",
        message: `Canonical baseline is missing or incompatible: ${String(error)}`,
        guidance: "Review the corpus and run the complete suite with --update.",
      }),
    ),
  );
  if (
    baseline.corpusFingerprint !== expectedCorpusFingerprint ||
    baseline.judgeFingerprint !== judgeFingerprint()
  ) {
    return yield* BenchmarkWorkflowFailure.make({
      stage: "compatibility",
      message: "Canonical baseline corpus or judge fingerprint does not match.",
      guidance: "Review the change and run the complete suite with --update.",
    });
  }
  return baseline;
});

const provenance = Effect.fn("Benchmark.provenance")(function* () {
  const commit = yield* runBenchmarkProcess("git", ["rev-parse", "HEAD"], 30_000);
  yield* requireSuccessfulCommand("git_provenance", commit);
  const status = yield* runBenchmarkProcess("git", ["status", "--porcelain"], 30_000);
  yield* requireSuccessfulCommand("git_provenance", status);
  const pi = yield* runBenchmarkProcess("pi", ["--version"], 30_000);
  yield* requireSuccessfulCommand("pi_provenance", pi);
  return {
    recallRevision: { commit: commit.stdout.trim(), dirty: status.stdout.trim().length > 0 },
    piVersion: pi.stdout.trim(),
  };
});

const execute = Effect.fn("Benchmark.execute")(function* (options: BenchOptions) {
  const path = yield* Path.Path;
  const packagePath = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const baselinePath = path.join(packagePath, "baselines", "canonical.json");
  const suite = yield* loadCanonicalSuite(packagePath);
  const currentCorpusFingerprint = yield* corpusFingerprint(suite);
  const previous = options.update
    ? undefined
    : yield* readCompatibleBaseline(baselinePath, currentCorpusFingerprint);
  const prepared = yield* prepareCanonicalFixtures({
    fixtures: suite.fixtures,
    prepare: prepareFixture,
  });
  const subject = yield* makePublicCliRecallSubject();
  const judge = yield* makePiJudge();
  const run = yield* runScoredSuite({
    cases: suite.cases,
    fixtureVaults: fixtureVaultMap(prepared),
    subject,
    judge,
  });
  const observed = yield* provenance();
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const current = makeBaseline({
    corpusFingerprint: currentCorpusFingerprint,
    createdAt,
    recallRevision: observed.recallRevision,
    piVersion: observed.piVersion,
    run,
  });
  if (options.update) {
    yield* writeBaselineAtomically(baselinePath, current);
    return {
      _tag: "completed_update",
      destination: baselinePath,
      hardGateFailed: hasHardGateFailures(current),
      baseline: current,
    } satisfies BenchmarkResult;
  }
  if (previous === undefined) {
    return yield* BenchmarkWorkflowFailure.make({
      stage: "baseline",
      message: "Canonical baseline is unavailable.",
      guidance: "Run with --update.",
    });
  }
  return makeComparisonResult(previous, current);
});

const emit = Effect.fn("Benchmark.emit")(function* (
  result: BenchmarkResult,
  json: boolean,
  error: boolean,
) {
  const output = json ? yield* encodeBenchmarkResultJson(result) : renderHumanResult(result);
  if (error && !json) {
    yield* Console.error(output);
  } else {
    yield* Console.log(output);
  }
});

export const runBenchmarkCli = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
  const parsed = parseArguments(args);
  if (parsed._tag === "help") {
    yield* Console.log(usage);
    return;
  }
  if (parsed._tag === "invalid") {
    yield* emit(
      { _tag: "invalid_arguments", message: parsed.message, usage },
      args.includes("--json"),
      true,
    );
    process.exitCode = 2;
    return;
  }
  const result = yield* Effect.scoped(execute(parsed.options)).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        Schema.is(BenchmarkWorkflowFailure)(error)
          ? {
              _tag: "invalid_run" as const,
              stage: error.stage,
              errorTag: error._tag,
              message: error.message,
              guidance: error.guidance,
            }
          : {
              _tag: "invalid_run" as const,
              stage: "execution",
              errorTag: "OperationalFailure",
              message: String(error),
              guidance: "Resolve the operational failure and rerun the complete suite.",
            },
      ),
    ),
  );
  const failed =
    result._tag === "invalid_run" || ("hardGateFailed" in result && result.hardGateFailed);
  yield* emit(result, parsed.options.json, result._tag === "invalid_run");
  if (failed) {
    process.exitCode = 1;
  }
});

const Runtime = ManagedRuntime.make(BunServices.layer);
if (import.meta.main) {
  const { BunRuntime } = await import("@effect/platform-bun");
  BunRuntime.runMain(
    Runtime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(runBenchmarkCli(Bun.argv.slice(2)), context),
      ),
      Effect.ensuring(Runtime.disposeEffect),
    ),
  );
}
