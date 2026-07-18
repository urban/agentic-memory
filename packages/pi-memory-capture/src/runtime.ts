import packageJson from "../package.json" with { type: "json" };
import * as BunServices from "@effect/platform-bun/BunServices";
import { makeCaptureObservabilityLayer } from "@urban/agentic-memory-core/observability/CaptureTelemetry";
import { Effect, Layer, ManagedRuntime } from "effect";
import { CaptureConfig } from "./services/CaptureConfig.ts";
import { Markers } from "./services/Markers.ts";
import { MemorySteward, MemoryStewardError, StewardExecutor } from "./services/MemorySteward.ts";
import { Preprocessor } from "./services/Preprocessor.ts";
import { VaultProjects } from "./services/VaultProjects.ts";

type ExtensionAPI = import("@earendil-works/pi-coding-agent").ExtensionAPI;

const mergeAbortSignals = (
  effectSignal: AbortSignal,
  execSignal: AbortSignal | undefined,
): {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
} => {
  if (execSignal === undefined) {
    return {
      signal: effectSignal,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  if (effectSignal.aborted || execSignal.aborted) {
    controller.abort();
    return {
      signal: controller.signal,
      cleanup: () => undefined,
    };
  }

  effectSignal.addEventListener("abort", abort, { once: true });
  execSignal.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      effectSignal.removeEventListener("abort", abort);
      execSignal.removeEventListener("abort", abort);
    },
  };
};

const makeStewardExecutorLayer = (pi: ExtensionAPI) =>
  Layer.succeed(
    StewardExecutor,
    StewardExecutor.of({
      exec: (command, args, options) =>
        Effect.tryPromise({
          try: (signal) => {
            const merged = mergeAbortSignals(signal, options?.signal);
            const execOptions = {
              ...options,
              signal: merged.signal,
            };

            return pi.exec(command, [...args], execOptions).finally(merged.cleanup);
          },
          catch: (cause) =>
            new MemoryStewardError({
              message: `Failed to launch Memory Steward command: ${command}`,
              cause,
            }),
        }),
    }),
  );

export const makeMemoryCaptureRuntime = (pi: ExtensionAPI) => {
  const infrastructureLayer = Layer.mergeAll(BunServices.layer, makeStewardExecutorLayer(pi));
  const captureConfigLayer = CaptureConfig.layer;
  const servicesLayer = Layer.mergeAll(
    VaultProjects.layer,
    captureConfigLayer,
    Markers.layer,
    Preprocessor.layer,
    MemorySteward.layer.pipe(Layer.provideMerge(captureConfigLayer)),
  ).pipe(Layer.provideMerge(infrastructureLayer));
  const observabilityLayer = makeCaptureObservabilityLayer({
    serviceName: "agentic-memory-pi-capture",
    serviceVersion: packageJson.version,
    component: "pi-capture",
    harness: "pi",
  });

  return ManagedRuntime.make(Layer.merge(servicesLayer, observabilityLayer));
};
