import { Effect, Schema } from "effect";
import { validateLocalSynthesisEndpoint } from "../src/recall/LocalSynthesisEndpoint.ts";

export class SemanticStackProbeConfigurationError extends Schema.TaggedError<SemanticStackProbeConfigurationError>()(
  "SemanticStackProbeConfigurationError",
  {
    reason: Schema.Literals(["MissingSynthesisEndpoint", "InvalidSynthesisEndpoint"]),
    message: Schema.String,
  },
) {}

export const requireSemanticStackProbeSynthesisEndpoint = Effect.fnUntraced(function* (
  input?: unknown,
): Effect.fn.Return<string, SemanticStackProbeConfigurationError> {
  if (input === undefined) {
    return yield* SemanticStackProbeConfigurationError.make({
      reason: "MissingSynthesisEndpoint",
      message:
        "Set AGENTIC_MEMORY_SYNTHESIS_URL to the running loopback Qwen endpoint before running the semantic stack probe.",
    });
  }

  return yield* validateLocalSynthesisEndpoint(input).pipe(
    Effect.mapError((cause) =>
      SemanticStackProbeConfigurationError.make({
        reason: "InvalidSynthesisEndpoint",
        message: cause.message,
      }),
    ),
  );
});
