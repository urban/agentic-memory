import {
  encodeRecallSuccessJson,
  recall,
  type RecallError,
} from "@urban/agentic-memory-core/recall/Recall";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { commandRoot } from "./root.ts";

const toRecallFailure = (cause: RecallError) => {
  switch (cause.reason) {
    case "InvalidQuestion":
      return toFailure({
        code: "InvalidRecallQuestion",
        message: cause.message,
      });
    case "ReadVaultFailed":
      return toFailure({
        code: "ReadVaultFailed",
        message: cause.message,
      });
  }
};

export const commandRecall = Command.make(
  "recall",
  {
    question: Argument.string("question").pipe(
      Argument.withDescription("Natural-language memory question"),
    ),
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Absolute path to the Agentic Memory vault"),
    ),
    includeSources: Flag.boolean("include-sources").pipe(
      Flag.withDescription("Include source files as eligible recall material"),
    ),
  },
  Effect.fnUntraced(function* ({ includeSources, question, vaultPath }) {
    const root = yield* commandRoot;
    const result = yield* recall({ includeSources, question, vaultPath }).pipe(
      Effect.mapError(toRecallFailure),
    );
    const jsonText = yield* encodeRecallSuccessJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode recall result: ${cause.message}`,
        }),
      ),
    );

    return yield* Console.log(root.json ? jsonText : result.answer);
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Recall an answer from an Agentic Memory vault"),
  Command.withExamples([
    {
      command:
        'agentic-memory recall "In Alpha Product, what latency budget should I follow?" --vault /absolute/path/to/vault --json',
      description: "Parse the public recall CLI shape used by the benchmark",
    },
    {
      command:
        'agentic-memory recall "What source evidence supports the Alpha decision?" --vault /absolute/path/to/vault --include-sources --json',
      description: "Explicitly make source files eligible for recall",
    },
  ]),
);
