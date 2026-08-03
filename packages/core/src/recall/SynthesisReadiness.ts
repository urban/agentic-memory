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

type ModelsInspection =
  | { readonly _tag: "incompatible" }
  | { readonly _tag: "decoded"; readonly models: typeof ModelsResponse.Type };

const incompatibleModels = (): ModelsInspection => ({ _tag: "incompatible" });
const decodedModels = (models: typeof ModelsResponse.Type): ModelsInspection => ({
  _tag: "decoded",
  models,
});

const readiness = (status: SynthesisReadinessStatus, warning?: string): SynthesisReadiness => ({
  status,
  modelAlias: LOCAL_SYNTHESIS_MODEL_ALIAS,
  warnings: warning === undefined ? [] : [warning],
});

const request = Effect.fnUntraced(function* (url: string) {
  const client = yield* HttpClient.HttpClient;
  return yield* client
    .get(url)
    .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));
});

const withReadinessTimeout = Effect.timeoutOption(SYNTHESIS_READINESS_TIMEOUT);

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

  const healthResult = yield* request(`${endpoint}/health`).pipe(
    withReadinessTimeout,
    Effect.result,
  );
  if (
    healthResult._tag === "Failure" ||
    Option.isNone(healthResult.success) ||
    healthResult.success.value.status < 200 ||
    healthResult.success.value.status >= 300
  ) {
    return readiness(
      "server_unavailable",
      "The configured local synthesis server is unavailable or unhealthy.",
    );
  }

  const modelsResult = yield* request(`${endpoint}/models`).pipe(
    Effect.flatMap((response) =>
      response.status < 200 || response.status >= 300
        ? Effect.succeed(incompatibleModels())
        : HttpClientResponse.schemaBodyJson(ModelsResponse)(response).pipe(
            Effect.match({ onFailure: incompatibleModels, onSuccess: decodedModels }),
          ),
    ),
    withReadinessTimeout,
    Effect.result,
  );
  if (modelsResult._tag === "Failure" || Option.isNone(modelsResult.success)) {
    return readiness("server_unavailable", "The configured local synthesis server is unavailable.");
  }
  const modelsInspection = modelsResult.success.value;
  if (
    modelsInspection._tag === "incompatible" ||
    !modelsInspection.models.data.some(({ id }) => id === LOCAL_SYNTHESIS_MODEL_ALIAS)
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
