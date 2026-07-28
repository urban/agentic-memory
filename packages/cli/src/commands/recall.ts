import { encodeRecallSuccessJson, recall } from "@urban/agentic-memory-core/recall/Recall";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";
import { commandRoot } from "./root.ts";

type RecallError = import("@urban/agentic-memory-core/recall/Recall").RecallError;

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
    case "SemanticIndexNotReady":
      return toFailure({
        code: "SemanticIndexNotReady",
        message: cause.message,
      });
    case "QueryEmbeddingFailed":
      return toFailure({
        code: "QueryEmbeddingFailed",
        message: cause.message,
      });
    case "SemanticSearchFailed":
      return toFailure({
        code: "SemanticSearchFailed",
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
    vaultPath: Flag.string("vault").pipe(Flag.withDescription("Path to the Agentic Memory vault")),
  },
  Effect.fnUntraced(function* ({ question, vaultPath }) {
    const root = yield* commandRoot;
    const resolvedVaultPath = yield* resolvePathInput(root.directory.path, vaultPath, "Vault path");
    const result = yield* recall({
      question,
      vaultPath: resolvedVaultPath,
    }).pipe(Effect.mapError(toRecallFailure));
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
        'agentic-memory -C /absolute/path/to recall "In Alpha Product, what latency budget should I follow?" --vault vault --json',
      description: "Resolve a relative vault path and use the public recall CLI shape",
    },
  ]),
);
