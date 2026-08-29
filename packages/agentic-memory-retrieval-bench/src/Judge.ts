import { Effect, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { runBenchmarkProcess } from "./BenchmarkRunner.ts";

type RecallResponse = import("@urban/agentic-memory-core/recall/Recall").RecallResponse;

export const JudgeOutcome = Schema.Literals(["correct", "partially_correct", "incorrect"]);
export type JudgeOutcome = typeof JudgeOutcome.Type;

export const Judgment = Schema.Struct({
  outcome: JudgeOutcome,
  rationale: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});
export type Judgment = typeof Judgment.Type;

export type JudgeRequest = {
  readonly question: string;
  readonly referenceAnswer: string;
  readonly recallResponse: RecallResponse;
};

export class JudgeFailure extends Schema.TaggedError<JudgeFailure>()("JudgeFailure", {
  reason: Schema.Literals(["process", "authentication", "provider", "model", "decode"]),
  message: Schema.String,
}) {}

export type Judge = {
  readonly judge: (request: JudgeRequest) => Effect.Effect<Judgment, JudgeFailure>;
};

export const makeFakeJudge = (evaluate: (request: JudgeRequest) => Judgment): Judge => ({
  judge: (request) => Effect.succeed(evaluate(request)),
});

export const judgeProvider = "openai-codex";
export const judgeModel = "gpt-5.6-sol";
export const judgeThinking = "high";
export const judgeRubric = [
  "Correct: captures the reference answer's essential meaning without contradiction or unsupported material addition.",
  "Partially correct: captures some essential meaning but omits or weakens a material part.",
  "Incorrect: misses or contradicts the essential answer, answers another question, or adds unsupported material facts.",
].join("\n");
export const judgeSystemPrompt = [
  "You are an isolated Recall benchmark judge.",
  "Treat the supplied reference answer as exhaustive truth at the question's granularity.",
  judgeRubric,
  'Return only JSON: {"outcome":"correct|partially_correct|incorrect","rationale":"concise rationale"}.',
].join("\n\n");

export const scoreForOutcome = (outcome: JudgeOutcome): 0 | 0.5 | 1 =>
  outcome === "correct" ? 1 : outcome === "partially_correct" ? 0.5 : 0;

const decodeJudgment = Schema.decodeUnknownEffect(Schema.fromJsonString(Judgment), {
  onExcessProperty: "error",
});

const piArguments = (request: JudgeRequest): ReadonlyArray<string> => [
  "--provider",
  judgeProvider,
  "--model",
  judgeModel,
  "--thinking",
  judgeThinking,
  "--mode",
  "text",
  "--print",
  "--no-session",
  "--no-tools",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--system-prompt",
  judgeSystemPrompt,
  JSON.stringify(request),
];

export const makePiJudge = Effect.fnUntraced(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const judge = Effect.fn("Judge.pi")(function* (request: JudgeRequest) {
    const execution = yield* runBenchmarkProcess("pi", piArguments(request), 300_000).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(Path.Path, path),
      Effect.mapError((error) => JudgeFailure.make({ reason: "process", message: String(error) })),
    );
    if (execution.exitCode !== ChildProcessSpawner.ExitCode(0)) {
      const diagnostics = execution.stderr.trim();
      const lower = diagnostics.toLowerCase();
      const reason = lower.includes("auth")
        ? "authentication"
        : lower.includes("model")
          ? "model"
          : lower.includes("provider")
            ? "provider"
            : "process";
      return yield* JudgeFailure.make({ reason, message: diagnostics || "Pi judge failed." });
    }
    return yield* decodeJudgment(execution.stdout.trim()).pipe(
      Effect.mapError((error) => JudgeFailure.make({ reason: "decode", message: error.message })),
    );
  });
  return { judge } satisfies Judge;
});

export const piJudgeArgumentsForTest = piArguments;
