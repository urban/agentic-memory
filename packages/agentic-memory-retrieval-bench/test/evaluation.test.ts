import { assert, it, layer } from "@effect/vitest";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { runBenchmarkProcess } from "../src/BenchmarkRunner.ts";
import { evaluateCase } from "../src/Evaluation.ts";
import { makeFakeJudge, piJudgeArgumentsForTest } from "../src/Judge.ts";
import { aggregateScoredCases } from "../src/ScoredRun.ts";

const answeredCase = {
  id: "case",
  fixtureId: "project-memory",
  question: "What is the budget?",
  expected: {
    status: "answered",
    referenceAnswer: "The budget is 200ms p95.",
    forbiddenFacts: ["400ms p95"],
  },
} as const;

it.effect("applies deterministic gates before isolated semantic judgment", () =>
  Effect.gen(function* () {
    let judgeCalls = 0;
    const judge = makeFakeJudge(() => {
      judgeCalls += 1;
      return { outcome: "correct", rationale: "Equivalent meaning." };
    });
    const failed = yield* evaluateCase({
      benchmarkCase: answeredCase,
      observation: {
        durationMs: 1,
        response: {
          status: "not_found",
          question: answeredCase.question,
          answer: "Use 400MS\n p95.",
          warnings: [],
        },
      },
      judge,
    });
    assert.strictEqual(failed.outcome, "incorrect");
    assert.strictEqual(failed.source, "deterministic");
    assert.strictEqual(failed.hardGateViolations.length, 2);
    assert.strictEqual(judgeCalls, 0);

    const judged = yield* evaluateCase({
      benchmarkCase: answeredCase,
      observation: {
        durationMs: 1,
        response: {
          status: "answered",
          question: answeredCase.question,
          answer: "Use 200ms p95.",
          warnings: [],
        },
      },
      judge,
    });
    assert.strictEqual(judged.outcome, "correct");
    assert.strictEqual(judged.score, 1);
    assert.strictEqual(judgeCalls, 1);
  }),
);

it("pins the isolated Pi subscription judge invocation", () => {
  const args = piJudgeArgumentsForTest({
    question: answeredCase.question,
    referenceAnswer: answeredCase.expected.referenceAnswer,
    recallResponse: {
      status: "answered",
      question: answeredCase.question,
      answer: "Use 200ms p95.",
      warnings: [],
    },
  });
  assert.include(args, "openai-codex");
  assert.include(args, "gpt-5.6-sol");
  assert.include(args, "high");
  for (const flag of [
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ]) {
    assert.include(args, flag);
  }
});

layer(BunServices.layer)("benchmark subprocess execution", (it) => {
  it.effect("closes stdin for non-interactive benchmark subprocesses", () => {
    let stdin: unknown;
    const spawner = ChildProcessSpawner.make((command) => {
      stdin = ChildProcess.isStandardCommand(command) ? command.options.stdin : undefined;
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(12345),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      );
    });

    return runBenchmarkProcess("pi", ["--version"], 30_000).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.map(() => {
        assert.strictEqual(stdin, "ignore");
      }),
    );
  });
});

it("derives equal-weight score and lean metrics", () => {
  const response = {
    status: "answered" as const,
    question: answeredCase.question,
    answer: "Use 200ms p95.",
    warnings: [],
  };
  const run = aggregateScoredCases([
    {
      benchmarkCase: answeredCase,
      observation: { response, durationMs: 10 },
      evaluation: {
        source: "judge",
        outcome: "correct",
        score: 1,
        rationale: "Correct.",
        hardGateViolations: [],
      },
    },
    {
      benchmarkCase: answeredCase,
      observation: { response, durationMs: 30 },
      evaluation: {
        source: "judge",
        outcome: "partially_correct",
        score: 0.5,
        rationale: "Partial.",
        hardGateViolations: [],
      },
    },
  ]);
  assert.strictEqual(run.score, 75);
  assert.strictEqual(run.metrics.correctCount, 1);
  assert.strictEqual(run.metrics.partiallyCorrectCount, 1);
  assert.strictEqual(run.metrics.recallLatencyP50Ms, 10);
  assert.strictEqual(run.metrics.recallLatencyP95Ms, 30);
});
