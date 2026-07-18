import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";
import { resolveCaptureCorrelation } from "../src/commands/capture-correlation-input.ts";

const noCorrelationInput = {
  attemptId: Option.none<string>(),
  runId: Option.none<string>(),
  triggerKind: Option.none<string>(),
  projectSlug: Option.none<string>(),
};

describe("capture correlation CLI input", () => {
  it.effect("assembles explicit correlation input", () =>
    resolveCaptureCorrelation({
      attemptId: Option.some("attempt-explicit"),
      runId: Option.some("run-explicit"),
      triggerKind: Option.some("threshold"),
      projectSlug: Option.some("example-project"),
    }).pipe(
      Effect.map((correlation) => {
        assert.deepStrictEqual(correlation, {
          attemptId: "attempt-explicit",
          captureRunId: "run-explicit",
          triggerKind: "threshold",
          projectSlug: "example-project",
        });
      }),
    ),
  );

  it.effect("falls back to capture correlation environment variables", () =>
    resolveCaptureCorrelation(noCorrelationInput).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: {
            AGENTIC_MEMORY_CAPTURE_ATTEMPT_ID: "attempt-environment",
            AGENTIC_MEMORY_CAPTURE_RUN_ID: "run-environment",
            AGENTIC_MEMORY_CAPTURE_TRIGGER_KIND: "manual",
            AGENTIC_MEMORY_CAPTURE_PROJECT_SLUG: "environment-project",
          },
        }),
      ),
      Effect.map((correlation) => {
        assert.deepStrictEqual(correlation, {
          attemptId: "attempt-environment",
          captureRunId: "run-environment",
          triggerKind: "manual",
          projectSlug: "environment-project",
        });
      }),
    ),
  );

  it.effect("prefers explicit correlation input over environment variables", () =>
    resolveCaptureCorrelation({
      ...noCorrelationInput,
      attemptId: Option.some("attempt-explicit"),
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: {
            AGENTIC_MEMORY_CAPTURE_ATTEMPT_ID: "attempt-environment",
          },
        }),
      ),
      Effect.map((correlation) => {
        assert.deepStrictEqual(correlation, {
          attemptId: "attempt-explicit",
        });
      }),
    ),
  );

  it.effect("omits correlation when every input is absent", () =>
    resolveCaptureCorrelation(noCorrelationInput).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      Effect.map((correlation) => {
        assert.isUndefined(correlation);
      }),
    ),
  );
});
