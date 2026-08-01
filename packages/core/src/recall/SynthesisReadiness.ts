import { Config, Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  LOCAL_SYNTHESIS_MODEL_ALIAS,
  validateLocalSynthesisEndpoint,
} from "./LocalSynthesisEndpoint.ts";

export { LOCAL_SYNTHESIS_MODEL_ALIAS } from "./LocalSynthesisEndpoint.ts";

export const SYNTHESIS_READINESS_TIMEOUT = "3 seconds";

export const SynthesisReadinessStatus = Schema.Literals([
  "missing_configuration",
  "invalid_configuration",
  "server_unavailable",
  "server_incompatible",
  "ready",
]);
export type SynthesisReadinessStatus = typeof SynthesisReadinessStatus.Type;

export const SynthesisReadiness = Schema.Struct({
  status: SynthesisReadinessStatus,
  modelAlias: Schema.Literal(LOCAL_SYNTHESIS_MODEL_ALIAS),
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "SynthesisReadiness" });
export type SynthesisReadiness = typeof SynthesisReadiness.Type;

const ModelsResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
    }),
  ),
}).annotate({ identifier: "LocalSynthesisModelsResponse" });

const readiness = (status: SynthesisReadinessStatus, warning?: string): SynthesisReadiness => ({
  status,
  modelAlias: LOCAL_SYNTHESIS_MODEL_ALIAS,
  warnings: warning === undefined ? [] : [warning],
});

const request = Effect.fnUntraced(function* (url: string) {
  const client = yield* HttpClient.HttpClient;
  return yield* client.get(url).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.timeoutOrElse({
      duration: SYNTHESIS_READINESS_TIMEOUT,
      orElse: () => Effect.fail("timeout"),
    }),
  );
});

export const inspectLocalSynthesisReadiness = Effect.fnUntraced(function* (
  endpointInput: unknown,
): Effect.fn.Return<SynthesisReadiness, never, HttpClient.HttpClient> {
  if (endpointInput === undefined) {
    return readiness(
      "missing_configuration",
      "Local synthesis is not configured. Set AGENTIC_MEMORY_SYNTHESIS_URL.",
    );
  }

  const endpointResult = yield* validateLocalSynthesisEndpoint(endpointInput).pipe(Effect.result);
  if (endpointResult._tag === "Failure") {
    return readiness(
      "invalid_configuration",
      "Local synthesis configuration must be a loopback HTTP endpoint without credentials, query parameters, or fragments.",
    );
  }
  const endpoint = endpointResult.success;

  const healthResult = yield* request(`${endpoint}/health`).pipe(Effect.result);
  if (
    healthResult._tag === "Failure" ||
    healthResult.success.status < 200 ||
    healthResult.success.status >= 300
  ) {
    return readiness(
      "server_unavailable",
      "The configured local synthesis server is unavailable or unhealthy.",
    );
  }

  const modelsResponseResult = yield* request(`${endpoint}/models`).pipe(Effect.result);
  if (modelsResponseResult._tag === "Failure") {
    return readiness("server_unavailable", "The configured local synthesis server is unavailable.");
  }
  if (modelsResponseResult.success.status < 200 || modelsResponseResult.success.status >= 300) {
    return readiness(
      "server_incompatible",
      `The local synthesis server must expose the ${LOCAL_SYNTHESIS_MODEL_ALIAS} model alias.`,
    );
  }
  const modelsResult = yield* HttpClientResponse.schemaBodyJson(ModelsResponse)(
    modelsResponseResult.success,
  ).pipe(Effect.result);
  if (
    modelsResult._tag === "Failure" ||
    !modelsResult.success.data.some(({ id }) => id === LOCAL_SYNTHESIS_MODEL_ALIAS)
  ) {
    return readiness(
      "server_incompatible",
      `The local synthesis server must expose the ${LOCAL_SYNTHESIS_MODEL_ALIAS} model alias.`,
    );
  }

  return readiness("ready");
});

const configuredEndpoint = Config.string("AGENTIC_MEMORY_SYNTHESIS_URL").pipe(Config.option);

export const inspectConfiguredSynthesisReadiness: Effect.Effect<
  SynthesisReadiness,
  never,
  HttpClient.HttpClient
> = configuredEndpoint.pipe(
  Effect.map(Option.getOrUndefined),
  Effect.flatMap(inspectLocalSynthesisReadiness),
  Effect.orElseSucceed(() =>
    readiness(
      "invalid_configuration",
      "AGENTIC_MEMORY_SYNTHESIS_URL could not be read from the local configuration.",
    ),
  ),
);
