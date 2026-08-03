import { encodeRecallSuccessJson, recall } from "@urban/agentic-memory-core/recall/Recall";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";
import { commandRoot } from "./root.ts";

type RecallError = import("@urban/agentic-memory-core/recall/Recall").RecallError;

const toRecallFailure = (vaultPath: string, cause: RecallError) => {
  switch (cause.reason) {
    case "InvalidQuestion":
      return toFailure({
        code: "InvalidRecallQuestion",
        message: cause.message,
      });
    case "UnsupportedMultipartQuestion":
      return toFailure({
        code: "UnsupportedMultipartQuestion",
        message: cause.message,
      });
    case "ReadVaultFailed":
      return toFailure({
        code: "ReadVaultFailed",
        message: `Failed to read the Agentic Memory vault; run agentic-memory status --vault ${vaultPath}.`,
      });
    case "SemanticIndexMissing":
      return toFailure({
        code: "SemanticIndexMissing",
        message: `Semantic index is missing; run agentic-memory index --vault ${vaultPath}.`,
      });
    case "SemanticIndexStale":
      return toFailure({
        code: "SemanticIndexStale",
        message: `Semantic index is stale; run agentic-memory index --vault ${vaultPath}.`,
      });
    case "SemanticIndexIncomplete":
      return toFailure({
        code: "SemanticIndexIncomplete",
        message: `Semantic index is incomplete; run agentic-memory index --vault ${vaultPath}.`,
      });
    case "SemanticIndexInvalid":
      return toFailure({
        code: "SemanticIndexInvalid",
        message: `Semantic index is invalid; run agentic-memory index --vault ${vaultPath} --delete, then run agentic-memory index --vault ${vaultPath}.`,
      });
    case "SemanticIndexIncompatible":
      return toFailure({
        code: "SemanticIndexIncompatible",
        message: `Semantic index is incompatible; run agentic-memory index --vault ${vaultPath} --delete, then run agentic-memory index --vault ${vaultPath}.`,
      });
    case "SemanticIndexNotReady":
      return toFailure({
        code: "SemanticIndexNotReady",
        message: `Recall is not ready; run agentic-memory status --vault ${vaultPath}.`,
      });
    case "QueryEmbeddingFailed":
      return toFailure({
        code: "QueryEmbeddingFailed",
        message: `Failed to prepare the recall query; run agentic-memory status --vault ${vaultPath}, then try again.`,
      });
    case "SemanticSearchFailed":
      return toFailure({
        code: "SemanticSearchFailed",
        message: `Failed to search Agentic Memory; run agentic-memory status --vault ${vaultPath}, then try again.`,
      });
    case "EvidenceHydrationFailed":
      return toFailure({
        code: "EvidenceHydrationFailed",
        message: `Failed to hydrate current Agentic Memory evidence; run agentic-memory status --vault ${vaultPath}, then rebuild the index if needed.`,
      });
    case "SynthesisConfigurationMissing":
      return toFailure({
        code: "SynthesisConfigurationMissing",
        message:
          "Local synthesis is not configured; set AGENTIC_MEMORY_SYNTHESIS_URL to a loopback llama-server /v1 endpoint and start the required local server.",
      });
    case "SynthesisConfigurationInvalid":
      return toFailure({
        code: "SynthesisConfigurationInvalid",
        message:
          "Local synthesis configuration is invalid; set AGENTIC_MEMORY_SYNTHESIS_URL to a valid loopback HTTP llama-server /v1 endpoint.",
      });
    case "SynthesisEndpointNotLoopback":
      return toFailure({
        code: "SynthesisEndpointNotLoopback",
        message:
          "Local synthesis refused a non-loopback endpoint; use localhost, 127.0.0.0/8, or ::1.",
      });
    case "SynthesisServerUnavailable":
      return toFailure({
        code: "SynthesisServerUnavailable",
        message:
          "The local synthesis server is unavailable; start the configured llama-server and try again.",
      });
    case "SynthesisServerIncompatible":
      return toFailure({
        code: "SynthesisServerIncompatible",
        message:
          "The local synthesis server is incompatible; verify the required local model and server setup.",
      });
    case "SynthesisStructuredOutputFailed":
      return toFailure({
        code: "SynthesisStructuredOutputFailed",
        message:
          "The local synthesis server returned malformed structured output; verify the required local server setup and try again.",
      });
    case "GroundingValidationFailed":
      return toFailure({
        code: "GroundingValidationFailed",
        message:
          "The synthesized answer could not be grounded safely in Agentic Memory; try a narrower factual question.",
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
    }).pipe(Effect.mapError((cause) => toRecallFailure(resolvedVaultPath, cause)));
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
