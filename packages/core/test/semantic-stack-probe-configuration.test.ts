import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { requireSemanticStackProbeSynthesisEndpoint } from "../scripts/SemanticStackProbeConfiguration.ts";

describe("semantic stack probe configuration", () => {
  it.effect("requires a valid loopback synthesis endpoint", () =>
    Effect.gen(function* () {
      const missing = yield* requireSemanticStackProbeSynthesisEndpoint(undefined).pipe(
        Effect.flip,
      );
      const publicEndpoint = yield* requireSemanticStackProbeSynthesisEndpoint(
        "http://example.com/v1",
      ).pipe(Effect.flip);
      const loopbackEndpoint = yield* requireSemanticStackProbeSynthesisEndpoint(
        "http://127.0.0.1:8080/v1/",
      );

      assert.strictEqual(missing.reason, "MissingSynthesisEndpoint");
      assert.strictEqual(publicEndpoint.reason, "InvalidSynthesisEndpoint");
      assert.strictEqual(loopbackEndpoint, "http://127.0.0.1:8080/v1");
    }),
  );
});
