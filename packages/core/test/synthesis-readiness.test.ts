import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  inspectLocalSynthesisReadiness,
  LOCAL_SYNTHESIS_MODEL_ALIAS,
} from "../src/recall/SynthesisReadiness.ts";

type HttpClientRequest = import("effect/unstable/http/HttpClientRequest").HttpClientRequest;
type HttpClientResponseValue = import("effect/unstable/http/HttpClientResponse").HttpClientResponse;
type HttpClientErrorValue = import("effect/unstable/http/HttpClientError").HttpClientError;

const response = (
  request: HttpClientRequest,
  body: string,
  status = 200,
): HttpClientResponseValue =>
  HttpClientResponse.fromWeb(
    request,
    new Response(body, { status, headers: { "content-type": "application/json" } }),
  );

const makeHttpClient = (
  handler: (
    request: HttpClientRequest,
  ) => Effect.Effect<HttpClientResponseValue, HttpClientErrorValue>,
): HttpClient.HttpClient => HttpClient.make((request) => handler(request));

const inspectWith = (endpoint: unknown, client: HttpClient.HttpClient) =>
  inspectLocalSynthesisReadiness(endpoint).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
  );

describe("local synthesis readiness", () => {
  it.effect("distinguishes missing and invalid configuration without network access", () => {
    let requests = 0;
    const client = makeHttpClient(() => {
      requests += 1;
      return Effect.die("Unexpected readiness request");
    });

    return Effect.gen(function* () {
      const missing = yield* inspectWith(undefined, client);
      const invalid = yield* inspectWith("https://example.com/v1", client);

      assert.strictEqual(missing.status, "missing_configuration");
      assert.strictEqual(invalid.status, "invalid_configuration");
      assert.strictEqual(requests, 0);
    });
  });

  it.effect("checks health then models and requires the fixed alias", () => {
    const requests: Array<HttpClientRequest> = [];
    const client = makeHttpClient((request) => {
      requests.push(request);
      return Effect.succeed(
        response(
          request,
          request.url.endsWith("/models")
            ? `{"data":[{"id":"${LOCAL_SYNTHESIS_MODEL_ALIAS}"}]}`
            : "{}",
        ),
      );
    });

    return inspectWith("http://127.0.0.1:8080/v1/", client).pipe(
      Effect.map((result) => {
        assert.strictEqual(result.status, "ready");
        assert.deepStrictEqual(
          requests.map(({ method, url, body }) => ({ method, url, body: body._tag })),
          [
            { method: "GET", url: "http://127.0.0.1:8080/v1/health", body: "Empty" },
            { method: "GET", url: "http://127.0.0.1:8080/v1/models", body: "Empty" },
          ],
        );
      }),
    );
  });

  it.effect("reports unhealthy and unreachable servers as unavailable", () => {
    const transportFailure = makeHttpClient((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause: "offline" }),
        }),
      ),
    );
    const unhealthy = makeHttpClient((request) => Effect.succeed(response(request, "{}", 503)));

    return Effect.gen(function* () {
      const unreachable = yield* inspectWith("http://localhost:8080/v1", transportFailure);
      const unhealthyResult = yield* inspectWith("http://localhost:8080/v1", unhealthy);
      assert.strictEqual(unreachable.status, "server_unavailable");
      assert.strictEqual(unhealthyResult.status, "server_unavailable");
    });
  });

  it.effect.each([
    { name: "a missing alias", body: '{"data":[{"id":"another-model"}]}', status: 200 },
    { name: "malformed model data", body: '{"models":[]}', status: 200 },
    { name: "a rejected models endpoint", body: "{}", status: 404 },
  ])("reports $name as an incompatible server", ({ body, status }) => {
    const client = makeHttpClient((request) =>
      Effect.succeed(
        response(
          request,
          request.url.endsWith("/models") ? body : "{}",
          request.url.endsWith("/models") ? status : 200,
        ),
      ),
    );
    return inspectWith("http://localhost:8080/v1", client).pipe(
      Effect.map((result) => assert.strictEqual(result.status, "server_incompatible")),
    );
  });

  it.effect("times out after three seconds without retrying", () => {
    let requests = 0;
    const client = makeHttpClient(() => {
      requests += 1;
      return Effect.never;
    });

    return Effect.gen(function* () {
      const fiber = yield* inspectWith("http://localhost:8080/v1", client).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("3 seconds");
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.status, "server_unavailable");
      assert.strictEqual(requests, 1);
    });
  });

  it.effect("times out when the models response body stalls", () => {
    let requests = 0;
    const client = makeHttpClient((request) => {
      requests += 1;
      if (request.url.endsWith("/health")) return Effect.succeed(response(request, "{}"));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(new ReadableStream({ start() {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    });

    return Effect.gen(function* () {
      const fiber = yield* inspectWith("http://localhost:8080/v1", client).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("3 seconds");
      const result = yield* Fiber.join(fiber);

      assert.strictEqual(result.status, "server_unavailable");
      assert.strictEqual(requests, 2);
    });
  });

  it.effect("disables redirects for both observational requests", () => {
    const redirects: Array<RequestRedirect | undefined> = [];
    const fakeFetch = Object.assign(
      (_input: URL | RequestInfo, init?: BunFetchRequestInit | RequestInit) => {
        redirects.push(init?.redirect);
        const body =
          redirects.length === 2 ? `{"data":[{"id":"${LOCAL_SYNTHESIS_MODEL_ALIAS}"}]}` : "{}";
        return Promise.resolve(
          new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
        );
      },
      { preconnect: (_url: string | URL) => {} },
    );
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fakeFetch)),
    );

    return Effect.scoped(
      Layer.build(layer).pipe(
        Effect.flatMap((context) =>
          inspectLocalSynthesisReadiness("http://localhost:8080/v1").pipe(
            Effect.provideContext(context),
          ),
        ),
        Effect.map((result) => {
          assert.strictEqual(result.status, "ready");
          assert.deepStrictEqual(redirects, ["manual", "manual"]);
        }),
      ),
    );
  });
});
