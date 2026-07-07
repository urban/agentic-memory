import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

export const commandRecall = Command.make(
  "recall",
  {
    question: Argument.string("question").pipe(
      Argument.withDescription("Natural-language memory question"),
    ),
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Absolute path to the Agentic Memory vault"),
    ),
  },
  () => Effect.void,
).pipe(
  Command.withDescription("Recall an answer from an Agentic Memory vault"),
  Command.withExamples([
    {
      command:
        'agentic-memory recall "In Alpha Product, what latency budget should I follow?" --vault /absolute/path/to/vault --json',
      description: "Parse the public recall CLI shape used by the benchmark",
    },
  ]),
);
