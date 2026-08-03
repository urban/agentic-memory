import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import {
  LOCAL_SYNTHESIS_MODEL_ALIAS,
  runLocalQwenCompatibility,
  validateLocalSynthesisEndpoint,
} from "../src/compatibility/LocalQwenCompatibility.ts";

type HttpClientRequest = import("effect/unstable/http/HttpClientRequest").HttpClientRequest;
type HttpClientResponseValue = import("effect/unstable/http/HttpClientResponse").HttpClientResponse;
type HttpClientErrorValue = import("effect/unstable/http/HttpClientError").HttpClientError;

const GeneratedJsonSchema = Schema.Struct({
  anyOf: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("object"),
      properties: Schema.Record(Schema.String, Schema.Unknown),
      required: Schema.Array(Schema.String),
      additionalProperties: Schema.Literal(false),
    }),
  ),
});

const CompatibilityRequest = Schema.Struct({
  model: Schema.String,
  temperature: Schema.Finite,
  max_tokens: Schema.Finite,
  chat_template_kwargs: Schema.Struct({ enable_thinking: Schema.Boolean }),
  response_format: Schema.Struct({
    type: Schema.Literal("json_schema"),
    json_schema: Schema.Struct({
      name: Schema.String,
      strict: Schema.Boolean,
      schema: GeneratedJsonSchema,
    }),
  }),
});
const CompatibilityRequestJson = Schema.fromJsonString(CompatibilityRequest);
const decodeCompatibilityRequest = Schema.decodeUnknownEffect(CompatibilityRequestJson);

const answeredResponse = `{
  "id":"chatcmpl_answered",
  "object":"chat.completion",
  "model":"agentic-memory-qwen3-4b",
  "created":1,
  "choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"{\\"status\\":\\"answered\\",\\"answer\\":\\"azure-17\\",\\"claim\\":\\"The compatibility code is azure-17.\\",\\"evidenceIds\\":[\\"E1\\"],\\"providerModelIdentity\\":\\"absent\\"}"}}]
}`;

const notFoundResponse = `{
  "id":"chatcmpl_not_found",
  "object":"chat.completion",
  "model":"agentic-memory-qwen3-4b",
  "created":1,
  "choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"{\\"status\\":\\"not_found\\"}"}}]
}`;

const malformedResponse = `{
  "id":"chatcmpl_malformed",
  "object":"chat.completion",
  "model":"agentic-memory-qwen3-4b",
  "created":1,
  "choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"not-json"}}]
}`;

const reasoningResponse = `{
  "id":"chatcmpl_reasoning",
  "object":"chat.completion",
  "model":"agentic-memory-qwen3-4b",
  "created":1,
  "choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","reasoning_content":"I should think first.","content":"{\\"status\\":\\"answered\\",\\"answer\\":\\"azure-17\\",\\"claim\\":\\"The compatibility code is azure-17.\\",\\"evidenceIds\\":[\\"E1\\"],\\"providerModelIdentity\\":\\"absent\\"}"}}]
}`;

const jsonResponse = (
  request: HttpClientRequest,
  body: string,
  status = 200,
): HttpClientResponseValue =>
  HttpClientResponse.fromWeb(
    request,
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const requestBodyText = (request: HttpClientRequest): string => {
  const body = request.body;
  return body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
};

const makeHttpClient = (
  handler: (
    request: HttpClientRequest,
  ) => Effect.Effect<HttpClientResponseValue, HttpClientErrorValue>,
): HttpClient.HttpClient => HttpClient.make((request) => handler(request));

const withHttpClient = <A, E>(
  client: HttpClient.HttpClient,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> => effect.pipe(Effect.provideService(HttpClient.HttpClient, client));

describe("local Qwen compatibility spike", () => {
  it.effect("accepts only canonical loopback HTTP endpoint shapes", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* validateLocalSynthesisEndpoint("http://localhost:8080/v1/"),
        "http://localhost:8080/v1",
      );
      assert.strictEqual(
        yield* validateLocalSynthesisEndpoint("http://127.42.0.9:8080/v1"),
        "http://127.42.0.9:8080/v1",
      );
      assert.strictEqual(
        yield* validateLocalSynthesisEndpoint("http://[::1]:8080/v1"),
        "http://[::1]:8080/v1",
      );
    }),
  );

  it.effect("rejects non-loopback and unsafe URLs before any request", () => {
    let requests = 0;
    const client = makeHttpClient((request) => {
      requests += 1;
      return Effect.succeed(jsonResponse(request, answeredResponse));
    });

    return Effect.gen(function* () {
      const cases = [
        ["https://127.0.0.1:8080/v1", "HttpRequired"],
        ["http://user@127.0.0.1:8080/v1", "CredentialsNotAllowed"],
        ["http://127.0.0.1:8080/v1?host=remote", "QueryNotAllowed"],
        ["http://127.0.0.1:8080/v1#remote", "FragmentNotAllowed"],
        ["http://api.openai.com/v1", "NonLoopbackHost"],
      ];

      for (const [endpoint, reason] of cases) {
        const error = yield* runLocalQwenCompatibility(endpoint).pipe(Effect.flip, (effect) =>
          withHttpClient(client, effect),
        );
        assert.strictEqual(error._tag, "SynthesisEndpointError");
        if (error._tag === "SynthesisEndpointError") {
          assert.strictEqual(error.reason, reason);
        }
      }
      assert.strictEqual(requests, 0);
    });
  });

  it.effect(
    "uses Effect AI JSON Schema generation for both output variants without fallback",
    () => {
      const requests: Array<HttpClientRequest> = [];
      const decodedRequests: Array<typeof CompatibilityRequest.Type> = [];
      const client = makeHttpClient((request) =>
        Effect.gen(function* () {
          requests.push(request);
          decodedRequests.push(yield* request.pipe(requestBodyText, decodeCompatibilityRequest));
          return jsonResponse(request, requests.length === 1 ? answeredResponse : notFoundResponse);
        }).pipe(
          Effect.mapError(
            (cause) =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.EncodeError({ request, cause }),
              }),
          ),
        ),
      );

      return Effect.gen(function* () {
        const report = yield* runLocalQwenCompatibility("http://127.0.0.1:8080/v1").pipe((effect) =>
          withHttpClient(client, effect),
        );

        assert.strictEqual(report.answered.status, "answered");
        assert.strictEqual(report.notFound.status, "not_found");
        assert.isTrue(report.structuredOutputAccepted);
        assert.isTrue(report.nonThinking);
        assert.strictEqual(report.requestCount, 2);
        assert.strictEqual(requests.length, 2);
        assert.isTrue(
          requests.every((request) => request.url === "http://127.0.0.1:8080/v1/chat/completions"),
        );
        assert.isTrue(
          decodedRequests.every(
            (request) =>
              request.model === LOCAL_SYNTHESIS_MODEL_ALIAS &&
              request.temperature === 0 &&
              request.max_tokens === 768 &&
              request.chat_template_kwargs.enable_thinking === false &&
              request.response_format.type === "json_schema" &&
              request.response_format.json_schema.strict,
          ),
        );
        assert.isTrue(
          decodedRequests.every(
            (request) => request.response_format.json_schema.schema.anyOf.length === 2,
          ),
        );
        assert.isTrue(
          decodedRequests.every((request) =>
            request.response_format.json_schema.schema.anyOf.every(
              (branch) => branch.additionalProperties === false,
            ),
          ),
        );
      });
    },
  );

  it.effect("maps malformed model output to structured-output decoding failure", () => {
    const client = makeHttpClient((request) =>
      Effect.succeed(jsonResponse(request, malformedResponse)),
    );
    return Effect.gen(function* () {
      const error = yield* runLocalQwenCompatibility("http://127.0.0.1:8080/v1").pipe(
        Effect.flip,
        (effect) => withHttpClient(client, effect),
      );
      assert.strictEqual(error._tag, "SynthesisStructuredOutputError");
    });
  });

  it.effect("maps transport failures to server unavailable", () => {
    const client = makeHttpClient((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: "connection refused",
          }),
        }),
      ),
    );
    return Effect.gen(function* () {
      const error = yield* runLocalQwenCompatibility("http://127.0.0.1:8080/v1").pipe(
        Effect.flip,
        (effect) => withHttpClient(client, effect),
      );
      assert.strictEqual(error._tag, "SynthesisServerUnavailableError");
    });
  });

  it.effect("maps rejected structured requests to server incompatible", () => {
    const client = makeHttpClient((request) =>
      Effect.succeed(
        jsonResponse(
          request,
          '{"error":{"message":"json_schema is unsupported","type":"invalid_request_error"}}',
          400,
        ),
      ),
    );
    return Effect.gen(function* () {
      const error = yield* runLocalQwenCompatibility("http://127.0.0.1:8080/v1").pipe(
        Effect.flip,
        (effect) => withHttpClient(client, effect),
      );
      assert.strictEqual(error._tag, "SynthesisServerIncompatibleError");
    });
  });

  it.effect("fails compatibility when the server returns reasoning content", () => {
    const client = makeHttpClient((request) =>
      Effect.succeed(jsonResponse(request, reasoningResponse)),
    );
    return Effect.gen(function* () {
      const error = yield* runLocalQwenCompatibility("http://127.0.0.1:8080/v1").pipe(
        Effect.flip,
        (effect) => withHttpClient(client, effect),
      );
      assert.strictEqual(error._tag, "SynthesisServerIncompatibleError");
      assert.include(error.message, "reasoning");
    });
  });
});
