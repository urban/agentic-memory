#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Config, Console, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  runLocalQwenCompatibility,
  SynthesisCompatibilityReport,
} from "../src/compatibility/LocalQwenCompatibility.ts";

class CompatibilityPrerequisiteError extends Schema.TaggedError<CompatibilityPrerequisiteError>()(
  "CompatibilityPrerequisiteError",
  { message: Schema.String },
) {}

const CompatibilityReportJson = Schema.fromJsonString(SynthesisCompatibilityReport);
const encodeCompatibilityReport = Schema.encodeUnknownEffect(CompatibilityReportJson);

const program = Effect.gen(function* () {
  const optIn = yield* Config.string("AGENTIC_MEMORY_QWEN_COMPATIBILITY").pipe(Config.option);
  if (!Option.contains(optIn, "1")) {
    return yield* CompatibilityPrerequisiteError.make({
      message: "Set AGENTIC_MEMORY_QWEN_COMPATIBILITY=1 to run the live local-Qwen probe",
    });
  }

  const endpoint = yield* Config.string("AGENTIC_MEMORY_SYNTHESIS_URL").pipe(
    Effect.mapError(() =>
      CompatibilityPrerequisiteError.make({
        message: "Set AGENTIC_MEMORY_SYNTHESIS_URL to the loopback llama-server /v1 endpoint",
      }),
    ),
  );
  const report = yield* runLocalQwenCompatibility(endpoint);
  const json = yield* encodeCompatibilityReport(report);
  yield* Console.log(json);
});

const RuntimeLayer = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" }),
);
const CompatibilityRuntime = ManagedRuntime.make(RuntimeLayer);

if (import.meta.main) {
  BunRuntime.runMain(
    CompatibilityRuntime.contextEffect.pipe(
      Effect.flatMap((context) => Effect.provideContext(program, context)),
      Effect.ensuring(CompatibilityRuntime.disposeEffect),
    ),
  );
}
