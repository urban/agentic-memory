import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";
import { resolveCaptureCorrelation } from "../src/commands/capture-correlation-input.ts";

const noCorrelationInput = {
  attemptId: Option.none<string>(),
  runId: Option.none<string>(),
  triggerKind: Option.none<string>(),
};

describe("capture correlation CLI input", () => {
  it.effect("assembles explicit correlation input", () =>
    resolveCaptureCorrelation({
      attemptId: Option.some("attempt-explicit"),
      runId: Option.some("run-explicit"),
      triggerKind: Option.some("agent_end"),
    }).pipe(
      Effect.map((correlation) => {
        assert.deepStrictEqual(correlation, {
          attemptId: "attempt-explicit",
          captureRunId: "run-explicit",
          triggerKind: "agent_end",
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
            AGENTIC_MEMORY_CAPTURE_TRIGGER_KIND: "session_shutdown",
          },
        }),
      ),
      Effect.map((correlation) => {
        assert.deepStrictEqual(correlation, {
          attemptId: "attempt-environment",
          captureRunId: "run-environment",
          triggerKind: "session_shutdown",
        });
      }),
    ),
  );

  it.effect("prefers explicit correlation fields over their environment variables", () =>
    resolveCaptureCorrelation({
      attemptId: Option.some("attempt-explicit"),
      runId: Option.some("run-explicit"),
      triggerKind: Option.some("session_before_tree"),
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: {
            AGENTIC_MEMORY_CAPTURE_ATTEMPT_ID: "attempt-environment",
            AGENTIC_MEMORY_CAPTURE_RUN_ID: "run-environment",
            AGENTIC_MEMORY_CAPTURE_TRIGGER_KIND: "agent_end",
          },
        }),
      ),
      Effect.map((correlation) => {
        assert.deepStrictEqual(correlation, {
          attemptId: "attempt-explicit",
          captureRunId: "run-explicit",
          triggerKind: "session_before_tree",
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

  it.effect("rejects partial correlation from flags with a typed CLI failure", () =>
    resolveCaptureCorrelation({
      ...noCorrelationInput,
      attemptId: Option.some("attempt-only"),
    }).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      Effect.flip,
      Effect.map((failure) => {
        assert.strictEqual(failure._tag, "CliCommandFailure");
        assert.strictEqual(failure.code, "InvalidCaptureCorrelation");
        assert.strictEqual(failure.exitCode, 2);
      }),
    ),
  );

  it.effect("rejects partial correlation assembled across flags and environment variables", () =>
    resolveCaptureCorrelation({
      ...noCorrelationInput,
      attemptId: Option.some("attempt-explicit"),
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: {
            AGENTIC_MEMORY_CAPTURE_RUN_ID: "run-environment",
          },
        }),
      ),
      Effect.flip,
      Effect.map((failure) => {
        assert.strictEqual(failure.code, "InvalidCaptureCorrelation");
      }),
    ),
  );

  it.effect("rejects a complete correlation with an unknown trigger kind", () =>
    resolveCaptureCorrelation({
      attemptId: Option.some("attempt-explicit"),
      runId: Option.some("run-explicit"),
      triggerKind: Option.some("manual"),
    }).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      Effect.flip,
      Effect.map((failure) => {
        assert.strictEqual(failure.code, "InvalidCaptureCorrelation");
        assert.include(failure.message, "Invalid capture correlation");
      }),
    ),
  );
});
