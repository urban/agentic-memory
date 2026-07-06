import { Config, Effect, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

export interface CaptureCorrelation {
  readonly captureRunId?: string;
  readonly attemptId?: string;
  readonly triggerKind?: string;
  readonly projectSlug?: string;
}

export interface CaptureObservabilityOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly component: string;
  readonly harness?: string;
}

const defaultOtelBaseUrl = "http://127.0.0.1:27686";

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
};

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim();
  const withoutTrailingSlashes = trimTrailingSlashes(trimmed);
  return withoutTrailingSlashes.length === 0 ? defaultOtelBaseUrl : withoutTrailingSlashes;
};

const enabledFromString = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const observabilitySettings = Config.all({
  enabled: Config.string("AGENTIC_MEMORY_OTEL_ENABLED").pipe(
    Config.withDefault(""),
    Config.map(enabledFromString),
  ),
  baseUrl: Config.string("AGENTIC_MEMORY_OTEL_BASE_URL").pipe(
    Config.withDefault(defaultOtelBaseUrl),
    Config.map(normalizeBaseUrl),
  ),
});

const resourceAttributes = (options: CaptureObservabilityOptions): Record<string, unknown> => ({
  "agentic_memory.version": options.serviceVersion,
  "agentic_memory.component": options.component,
  ...(options.harness === undefined ? {} : { "agentic_memory.harness": options.harness }),
  "deployment.environment.name": "local",
});

export const makeCaptureObservabilityLayer = (
  options: CaptureObservabilityOptions,
): Layer.Layer<never> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const settings = yield* observabilitySettings;

      if (!settings.enabled) {
        return Logger.layer([]);
      }

      const resource = {
        serviceName: options.serviceName,
        serviceVersion: options.serviceVersion,
        attributes: resourceAttributes(options),
      };

      return Layer.mergeAll(
        OtlpTracer.layer({
          url: `${settings.baseUrl}/v1/traces`,
          resource,
          exportInterval: "500 millis",
          shutdownTimeout: "2 seconds",
        }),
        OtlpLogger.layer({
          url: `${settings.baseUrl}/v1/logs`,
          resource,
          exportInterval: "500 millis",
          shutdownTimeout: "2 seconds",
          mergeWithExisting: false,
        }),
      ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
    }),
  ).pipe(Layer.orDie);

export const captureCorrelationAttributes = (
  correlation: CaptureCorrelation | undefined,
): Record<string, unknown> => ({
  ...(correlation?.captureRunId === undefined
    ? {}
    : { "capture.run_id": correlation.captureRunId }),
  ...(correlation?.attemptId === undefined ? {} : { "capture.attempt_id": correlation.attemptId }),
  ...(correlation?.triggerKind === undefined
    ? {}
    : { "capture.trigger_kind": correlation.triggerKind }),
  ...(correlation?.projectSlug === undefined
    ? {}
    : { "capture.project_slug": correlation.projectSlug }),
});
