import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Effect, Schema } from "effect";
import { AiError, LanguageModel } from "effect/unstable/ai";
import {
  LOCAL_SYNTHESIS_MODEL_ALIAS,
  LOCAL_SYNTHESIS_TIMEOUT,
  SynthesisEndpointError,
  validateLocalSynthesisEndpoint,
} from "../recall/LocalSynthesisEndpoint.ts";
import {
  AnsweredRecallSynthesis,
  decodeRecallSynthesisGenerationOutput,
  NotFoundRecallSynthesis,
  RecallSynthesisGenerationOutput,
  RecallSynthesisOutput,
} from "../recall/RecallSynthesis.ts";

type HttpClient = import("effect/unstable/http/HttpClient").HttpClient;

const AnsweredCompatibilityOutput = AnsweredRecallSynthesis;
const NotFoundCompatibilityOutput = NotFoundRecallSynthesis;

export const SynthesisCompatibilityOutput = RecallSynthesisOutput;
export type SynthesisCompatibilityOutput = typeof SynthesisCompatibilityOutput.Type;

export const SynthesisCompatibilityReport = Schema.Struct({
  endpoint: Schema.String,
  model: Schema.Literal(LOCAL_SYNTHESIS_MODEL_ALIAS),
  answered: AnsweredCompatibilityOutput,
  notFound: NotFoundCompatibilityOutput,
  structuredOutputAccepted: Schema.Literal(true),
  nonThinking: Schema.Literal(true),
  requestCount: Schema.Literal(2),
}).annotate({ identifier: "SynthesisCompatibilityReport" });
export type SynthesisCompatibilityReport = typeof SynthesisCompatibilityReport.Type;

export class SynthesisServerUnavailableError extends Schema.TaggedError<SynthesisServerUnavailableError>()(
  "SynthesisServerUnavailableError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class SynthesisServerIncompatibleError extends Schema.TaggedError<SynthesisServerIncompatibleError>()(
  "SynthesisServerIncompatibleError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class SynthesisStructuredOutputError extends Schema.TaggedError<SynthesisStructuredOutputError>()(
  "SynthesisStructuredOutputError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

type SynthesisGenerationError =
  | SynthesisServerUnavailableError
  | SynthesisServerIncompatibleError
  | SynthesisStructuredOutputError;

export type SynthesisCompatibilityError = SynthesisEndpointError | SynthesisGenerationError;

export {
  LOCAL_SYNTHESIS_MODEL_ALIAS,
  LOCAL_SYNTHESIS_TIMEOUT,
  SynthesisEndpointError,
  validateLocalSynthesisEndpoint,
};

const mapAiError = (error: AiError.AiError): SynthesisGenerationError => {
  switch (error.reason._tag) {
    case "NetworkError":
    case "InternalProviderError":
      return SynthesisServerUnavailableError.make({
        message: "The local Qwen synthesis server is unavailable",
        cause: error,
      });
    case "StructuredOutputError":
      return SynthesisStructuredOutputError.make({
        message: "Qwen output did not decode through the required Effect Schema",
        cause: error,
      });
    default:
      return SynthesisServerIncompatibleError.make({
        message: "The local server is incompatible with the required Effect AI structured request",
        cause: error,
      });
  }
};

const makeLanguageModel = Effect.fnUntraced(function* (endpoint: string) {
  const client = yield* OpenAiClient.make({ apiUrl: endpoint });
  return yield* OpenAiLanguageModel.make({
    model: LOCAL_SYNTHESIS_MODEL_ALIAS,
    config: {
      temperature: 0,
      max_output_tokens: 768,
      chat_template_kwargs: { enable_thinking: false },
    },
  }).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));
});

const answeredPrompt = `This is a structured-output transport compatibility check, not a quality benchmark.
The only evidence is: [E1] The compatibility code is azure-17.
Return status answered, answer "azure-17", claim "The compatibility code is azure-17.", evidenceIds ["E1"], and providerModelIdentity absent because the answer and claim name no provider or model.`;

const notFoundPrompt = `This is a structured-output transport compatibility check, not a quality benchmark.
The supplied evidence does not identify a project owner.
Return status not_found and no other fields.`;

const generateCompatibilityCase = Effect.fnUntraced(function* (
  expectedStatus: SynthesisCompatibilityOutput["status"],
  prompt: string,
): Effect.fn.Return<
  SynthesisCompatibilityOutput,
  | SynthesisServerIncompatibleError
  | SynthesisServerUnavailableError
  | SynthesisStructuredOutputError,
  LanguageModel.LanguageModel
> {
  const response = yield* LanguageModel.generateObject({
    objectName: "agentic_memory_recall_result",
    prompt,
    schema: RecallSynthesisGenerationOutput,
  }).pipe(
    Effect.mapError(mapAiError),
    Effect.timeoutOrElse({
      duration: LOCAL_SYNTHESIS_TIMEOUT,
      orElse: () =>
        Effect.fail(
          SynthesisServerUnavailableError.make({
            message: "The local Qwen synthesis server did not respond within 60 seconds",
          }),
        ),
    }),
  );

  if (response.reasoning.length > 0) {
    return yield* SynthesisServerIncompatibleError.make({
      message: "The local Qwen server returned reasoning despite non-thinking mode",
    });
  }
  const value = yield* decodeRecallSynthesisGenerationOutput(response.value).pipe(
    Effect.mapError((cause) =>
      SynthesisStructuredOutputError.make({
        message: "Qwen output did not decode through the required Effect Schema",
        cause,
      }),
    ),
  );
  if (value.status !== expectedStatus) {
    return yield* SynthesisServerIncompatibleError.make({
      message: `The compatibility case expected ${expectedStatus} but received ${value.status}`,
    });
  }

  return value;
});

export const runLocalQwenCompatibility = Effect.fnUntraced(function* (
  endpointInput: unknown,
): Effect.fn.Return<SynthesisCompatibilityReport, SynthesisCompatibilityError, HttpClient> {
  const endpoint = yield* validateLocalSynthesisEndpoint(endpointInput);
  const model = yield* makeLanguageModel(endpoint);

  const results = yield* Effect.gen(function* () {
    const answered = yield* generateCompatibilityCase("answered", answeredPrompt);
    const notFound = yield* generateCompatibilityCase("not_found", notFoundPrompt);
    return { answered, notFound };
  }).pipe(Effect.provideService(LanguageModel.LanguageModel, model));

  if (results.answered.status !== "answered" || results.notFound.status !== "not_found") {
    return yield* SynthesisServerIncompatibleError.make({
      message: "The local server returned incompatible compatibility-case variants",
    });
  }

  return SynthesisCompatibilityReport.make({
    endpoint,
    model: LOCAL_SYNTHESIS_MODEL_ALIAS,
    answered: results.answered,
    notFound: results.notFound,
    structuredOutputAccepted: true,
    nonThinking: true,
    requestCount: 2,
  });
});
