import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer, ManagedRuntime } from "effect";
import { CaptureConfig } from "./services/CaptureConfig.ts";
import { Git } from "./services/Git.ts";
import { Markers } from "./services/Markers.ts";
import { MemorySteward, MemoryStewardError, StewardExecutor } from "./services/MemorySteward.ts";
import { Preprocessor } from "./services/Preprocessor.ts";
import { VaultProjects } from "./services/VaultProjects.ts";

const makeStewardExecutorLayer = (pi: ExtensionAPI) =>
  Layer.succeed(
    StewardExecutor,
    StewardExecutor.of({
      exec: (command, args, options) =>
        Effect.tryPromise({
          try: () => pi.exec(command, [...args], options),
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
  const captureConfigLayer = CaptureConfig.layer.pipe(Layer.provideMerge(VaultProjects.layer));
  const servicesLayer = Layer.mergeAll(
    VaultProjects.layer,
    captureConfigLayer,
    Git.layer,
    Markers.layer,
    Preprocessor.layer,
    MemorySteward.layer.pipe(Layer.provideMerge(captureConfigLayer)),
  ).pipe(Layer.provide(infrastructureLayer));

  return ManagedRuntime.make(servicesLayer);
};
