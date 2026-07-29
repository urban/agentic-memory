import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Effect, Schema } from "effect";
import { AiError, LanguageModel } from "effect/unstable/ai";

type HttpClient = import("effect/unstable/http/HttpClient").HttpClient;

export const LOCAL_SYNTHESIS_MODEL_ALIAS = "agentic-memory-qwen3-4b";
export const LOCAL_SYNTHESIS_TIMEOUT = "60 seconds";

const AnsweredCompatibilityOutput = Schema.Struct({
  status: Schema.Literal("answered"),
  answer: Schema.NonEmptyString,
  claim: Schema.NonEmptyString,
  evidenceIds: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
});

const NotFoundCompatibilityOutput = Schema.Struct({
  status: Schema.Literal("not_found"),
});

export const SynthesisCompatibilityOutput = Schema.Union([
  AnsweredCompatibilityOutput,
  NotFoundCompatibilityOutput,
]).annotate({ identifier: "SynthesisCompatibilityOutput" });
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

export class SynthesisEndpointError extends Schema.TaggedErrorClass<SynthesisEndpointError>()(
  "SynthesisEndpointError",
  {
    reason: Schema.Literals([
      "InvalidUrl",
      "HttpRequired",
      "CredentialsNotAllowed",
      "QueryNotAllowed",
      "FragmentNotAllowed",
      "NonLoopbackHost",
    ]),
    message: Schema.String,
  },
) {}

export class SynthesisServerUnavailableError extends Schema.TaggedErrorClass<SynthesisServerUnavailableError>()(
  "SynthesisServerUnavailableError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class SynthesisServerIncompatibleError extends Schema.TaggedErrorClass<SynthesisServerIncompatibleError>()(
  "SynthesisServerIncompatibleError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class SynthesisStructuredOutputError extends Schema.TaggedErrorClass<SynthesisStructuredOutputError>()(
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

const decodeUrl = Schema.decodeUnknownEffect(Schema.URLFromString);

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(hostname);

const normalizeEndpoint = (url: URL): string => {
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
};

export const validateLocalSynthesisEndpoint = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<string, SynthesisEndpointError> {
  const url = yield* decodeUrl(input).pipe(
    Effect.mapError(
      () =>
        new SynthesisEndpointError({
          reason: "InvalidUrl",
          message: "AGENTIC_MEMORY_SYNTHESIS_URL must be a valid absolute URL",
        }),
    ),
  );

  if (url.protocol !== "http:") {
    return yield* new SynthesisEndpointError({
      reason: "HttpRequired",
      message: "The local synthesis endpoint must use HTTP",
    });
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return yield* new SynthesisEndpointError({
      reason: "CredentialsNotAllowed",
      message: "The local synthesis endpoint must not contain credentials",
    });
  }
  if (url.search.length > 0) {
    return yield* new SynthesisEndpointError({
      reason: "QueryNotAllowed",
      message: "The local synthesis endpoint must not contain a query string",
    });
  }
  if (url.hash.length > 0) {
    return yield* new SynthesisEndpointError({
      reason: "FragmentNotAllowed",
      message: "The local synthesis endpoint must not contain a fragment",
    });
  }
  if (!isLoopbackHost(url.hostname)) {
    return yield* new SynthesisEndpointError({
      reason: "NonLoopbackHost",
      message: "The local synthesis endpoint must use localhost, 127.0.0.0/8, or ::1",
    });
  }

  return normalizeEndpoint(url);
});

const mapAiError = (error: AiError.AiError): SynthesisGenerationError => {
  switch (error.reason._tag) {
    case "NetworkError":
    case "InternalProviderError":
      return new SynthesisServerUnavailableError({
        message: "The local Qwen synthesis server is unavailable",
        cause: error,
      });
    case "StructuredOutputError":
      return new SynthesisStructuredOutputError({
        message: "Qwen output did not decode through the required Effect Schema",
        cause: error,
      });
    default:
      return new SynthesisServerIncompatibleError({
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
Return status answered, answer "azure-17", claim "The compatibility code is azure-17.", and evidenceIds ["E1"].`;

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
    schema: SynthesisCompatibilityOutput,
  }).pipe(
    Effect.mapError(mapAiError),
    Effect.timeoutOrElse({
      duration: LOCAL_SYNTHESIS_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new SynthesisServerUnavailableError({
            message: "The local Qwen synthesis server did not respond within 60 seconds",
          }),
        ),
    }),
  );

  if (response.reasoning.length > 0) {
    return yield* new SynthesisServerIncompatibleError({
      message: "The local Qwen server returned reasoning despite non-thinking mode",
    });
  }
  if (response.value.status !== expectedStatus) {
    return yield* new SynthesisServerIncompatibleError({
      message: `The compatibility case expected ${expectedStatus} but received ${response.value.status}`,
    });
  }

  return response.value;
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
    return yield* new SynthesisServerIncompatibleError({
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
