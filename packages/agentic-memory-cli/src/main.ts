#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect, ManagedRuntime } from "effect";
import { agenticMemoryProgram, appLayer } from "./cli.ts";

const AgenticMemoryRuntime = ManagedRuntime.make(appLayer);

if (import.meta.main) {
  BunRuntime.runMain(
    AgenticMemoryRuntime.contextEffect.pipe(
      Effect.flatMap((context) => Effect.provideContext(agenticMemoryProgram, context)),
      Effect.ensuring(AgenticMemoryRuntime.disposeEffect),
    ),
  );
}
