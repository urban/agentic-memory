import { RecallResponse } from "@urban/agentic-memory-core/recall/Recall";
import { createHash } from "node:crypto";
import { Effect, FileSystem, Path, Random, Schema } from "effect";
import { BenchmarkCase } from "./BenchmarkCase.ts";
import {
  JudgeOutcome,
  judgeModel,
  judgeProvider,
  judgeSystemPrompt,
  judgeThinking,
} from "./Judge.ts";

type CanonicalSuite = import("./BenchmarkManifest.ts").CanonicalSuite;
type ScoredRun = import("./ScoredRun.ts").ScoredRun;

const HardGateViolation = Schema.Union([
  Schema.TaggedStruct("status", { expected: Schema.String, actual: Schema.String }),
  Schema.TaggedStruct("forbidden_fact", { fact: Schema.String }),
]);

const CaseEvaluation = Schema.Struct({
  source: Schema.Literals(["deterministic", "judge"]),
  outcome: JudgeOutcome,
  score: Schema.Literals([0, 0.5, 1]),
  rationale: Schema.String,
  hardGateViolations: Schema.Array(HardGateViolation),
});

const RunMetrics = Schema.Struct({
  correctCount: Schema.Finite,
  partiallyCorrectCount: Schema.Finite,
  incorrectCount: Schema.Finite,
  statusAccuracy: Schema.Finite,
  forbiddenFactViolationCount: Schema.Finite,
  recallLatencyP50Ms: Schema.Finite,
  recallLatencyP95Ms: Schema.Finite,
});

const BaselineCase = Schema.Struct({
  benchmarkCase: BenchmarkCase,
  response: RecallResponse,
  durationMs: Schema.Finite,
  evaluation: CaseEvaluation,
});

export const CanonicalBaseline = Schema.Struct({
  corpusFingerprint: Schema.String,
  judgeFingerprint: Schema.String,
  createdAt: Schema.String,
  recallRevision: Schema.Struct({ commit: Schema.String, dirty: Schema.Boolean }),
  judge: Schema.Struct({
    provider: Schema.Literal("openai-codex"),
    model: Schema.Literal("gpt-5.6-sol"),
    thinking: Schema.Literal("high"),
    piVersion: Schema.String,
    promptFingerprint: Schema.String,
  }),
  score: Schema.Finite,
  metrics: RunMetrics,
  cases: Schema.Array(BaselineCase),
});
export type CanonicalBaseline = typeof CanonicalBaseline.Type;

const BaselineJson = Schema.fromJsonString(CanonicalBaseline);
export const decodeBaselineJson = Schema.decodeUnknownEffect(BaselineJson, {
  onExcessProperty: "error",
});
export const encodeBaselineJson = Schema.encodeEffect(BaselineJson);

export const sha256 = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const encodeCanonical = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const judgeFingerprint = (): string =>
  sha256(
    encodeCanonical({
      provider: judgeProvider,
      model: judgeModel,
      thinking: judgeThinking,
      systemPrompt: judgeSystemPrompt,
      outcomes: { correct: 1, partially_correct: 0.5, incorrect: 0 },
      request: ["question", "referenceAnswer", "recallResponse"],
      output: ["outcome", "rationale"],
    }),
  );

export const corpusFingerprint = Effect.fn("Baseline.corpusFingerprint")(function* (
  suite: CanonicalSuite,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureFiles = yield* Effect.forEach(suite.fixtures, (fixture) =>
    Effect.gen(function* () {
      const names = (yield* fs.readDirectory(fixture.overlayPath, { recursive: true }))
        .filter((name) => name.endsWith(".md"))
        .toSorted();
      const files = yield* Effect.forEach(names, (name) =>
        fs
          .readFile(path.join(fixture.overlayPath, name))
          .pipe(Effect.map((bytes) => ({ name, bytes: [...bytes] }))),
      );
      return { id: fixture.id, manifestPath: fixture.manifestPath, files };
    }),
  );
  return sha256(encodeCanonical({ id: suite.id, fixtures: fixtureFiles, cases: suite.cases }));
});

export const makeBaseline = (input: {
  readonly corpusFingerprint: string;
  readonly createdAt: string;
  readonly recallRevision: { readonly commit: string; readonly dirty: boolean };
  readonly piVersion: string;
  readonly run: ScoredRun;
}): CanonicalBaseline => ({
  corpusFingerprint: input.corpusFingerprint,
  judgeFingerprint: judgeFingerprint(),
  createdAt: input.createdAt,
  recallRevision: input.recallRevision,
  judge: {
    provider: judgeProvider,
    model: judgeModel,
    thinking: judgeThinking,
    piVersion: input.piVersion,
    promptFingerprint: sha256(judgeSystemPrompt),
  },
  score: input.run.score,
  metrics: input.run.metrics,
  cases: input.run.cases.map((item) => ({
    benchmarkCase: item.benchmarkCase,
    response: item.observation.response,
    durationMs: item.observation.durationMs,
    evaluation: item.evaluation,
  })),
});

export const writeBaselineAtomically = Effect.fn("Baseline.writeAtomically")(function* (
  baselinePath: string,
  baseline: CanonicalBaseline,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contents = `${yield* encodeBaselineJson(baseline)}\n`;
  const temporaryPath = `${baselinePath}.tmp-${yield* Random.nextInt}`;
  yield* fs.makeDirectory(path.dirname(baselinePath), { recursive: true });
  yield* Effect.acquireUseRelease(
    Effect.succeed(temporaryPath),
    (candidatePath) =>
      fs
        .writeFileString(candidatePath, contents)
        .pipe(Effect.andThen(fs.rename(candidatePath, baselinePath))),
    (candidatePath) => fs.remove(candidatePath).pipe(Effect.ignore),
  );
});
