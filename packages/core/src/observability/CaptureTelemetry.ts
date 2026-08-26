import { Config, Effect, Layer, Logger, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

type ProjectSlug = import("../link/ProjectSlug.ts").ProjectSlug;

export const CaptureRunId = Schema.String.pipe(Schema.brand("CaptureRunId")).annotate({
  identifier: "CaptureRunId",
});
export type CaptureRunId = typeof CaptureRunId.Type;

export const CaptureAttemptId = Schema.String.pipe(Schema.brand("CaptureAttemptId")).annotate({
  identifier: "CaptureAttemptId",
});
export type CaptureAttemptId = typeof CaptureAttemptId.Type;

export const CaptureTriggerKind = Schema.Literals([
  "agent_end",
  "session_before_tree",
  "session_shutdown",
]).annotate({
  identifier: "CaptureTriggerKind",
});
export type CaptureTriggerKind = typeof CaptureTriggerKind.Type;

export const CaptureCorrelation = Schema.Struct({
  captureRunId: CaptureRunId,
  attemptId: CaptureAttemptId,
  triggerKind: CaptureTriggerKind,
}).annotate({ identifier: "CaptureCorrelation" });
export type CaptureCorrelation = typeof CaptureCorrelation.Type;

export const decodeCaptureRunId = Schema.decodeUnknownEffect(CaptureRunId);
export const decodeCaptureAttemptId = Schema.decodeUnknownEffect(CaptureAttemptId);
export const decodeCaptureCorrelation = Schema.decodeUnknownEffect(CaptureCorrelation);

export type CaptureObservabilityOptions = {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly component: string;
  readonly harness?: string;
};

export type CaptureDecisionReportInput = {
  readonly durability: string;
  readonly selectedDestinations: ReadonlyArray<unknown>;
  readonly skippedDestinations: ReadonlyArray<unknown>;
  readonly decisionSummary: string;
};

export type CaptureStewardSessionInput = {
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly startedAt: string;
};

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

export const captureTelemetryContextAttributes = (
  projectSlug: ProjectSlug,
  correlation?: CaptureCorrelation,
): Record<string, unknown> => ({
  "capture.project_slug": projectSlug,
  ...(correlation === undefined
    ? {}
    : {
        "capture.run_id": correlation.captureRunId,
        "capture.attempt_id": correlation.attemptId,
        "capture.trigger_kind": correlation.triggerKind,
      }),
});

export const captureDecisionReportAttributes = (
  decisionReport: CaptureDecisionReportInput,
): Record<string, string | number> => ({
  "capture.decision.durability": decisionReport.durability,
  "capture.decision.selected_count": decisionReport.selectedDestinations.length,
  "capture.decision.skipped_count": decisionReport.skippedDestinations.length,
  "capture.decision.summary": decisionReport.decisionSummary,
});

export const captureStewardSessionAttributes = (
  stewardSession?: CaptureStewardSessionInput,
): Record<string, string> =>
  stewardSession === undefined
    ? {}
    : {
        "capture.steward.session_id": stewardSession.sessionId,
        "capture.steward.session_name": stewardSession.name,
        "capture.steward.session_cwd": stewardSession.cwd,
        "capture.steward.session_started_at": stewardSession.startedAt,
      };
