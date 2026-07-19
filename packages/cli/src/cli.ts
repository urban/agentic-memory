import packageJson from "../package.json" with { type: "json" };
import * as BunServices from "@effect/platform-bun/BunServices";
import { makeCaptureObservabilityLayer } from "@urban/agentic-memory-core/observability/CaptureTelemetry";
import { PiProcessRunnerLayer } from "@urban/agentic-memory-core/steward/PiProcessRunner";
import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { commandInit } from "./commands/init.ts";
import { commandLink } from "./commands/link.ts";
import { commandRecall } from "./commands/recall.ts";
import { commandRoot } from "./commands/root.ts";
import { commandRunSteward } from "./commands/run-steward.ts";
import { commandStatus } from "./commands/status.ts";
import { commandStewardContext } from "./commands/steward-context.ts";

export const cliVersion = packageJson.version;

type StewardRunner = import("@urban/agentic-memory-core/steward/StewardExecution").StewardRunner;

export type CliRequirements = BunServices.BunServices | StewardRunner;

const observabilityLayer = makeCaptureObservabilityLayer({
  serviceName: "agentic-memory-cli",
  serviceVersion: cliVersion,
  component: "cli",
});

export const appLayer: Layer.Layer<CliRequirements> = Layer.merge(
  PiProcessRunnerLayer.pipe(Layer.provideMerge(BunServices.layer)),
  observabilityLayer,
);

export const agenticMemoryCommand = commandRoot.pipe(
  Command.withSubcommands([
    commandInit,
    commandLink,
    commandRecall,
    commandStatus,
    commandStewardContext,
    commandRunSteward,
  ]),
);

export const runAgenticMemoryCommand = (args: ReadonlyArray<string>) =>
  Command.runWith(agenticMemoryCommand, { version: cliVersion })(args);

export const agenticMemoryProgram = agenticMemoryCommand.pipe(Command.run({ version: cliVersion }));
