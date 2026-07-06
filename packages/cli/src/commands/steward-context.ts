import {
  buildStewardContext,
  encodeStewardContextResultJson,
} from "@urban/agentic-memory-core/steward/StewardContext";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { commandRoot } from "./root.ts";
import {
  optionalProjectFlag,
  optionalVaultFlag,
  payloadFlag,
  projectRootFlag,
  readPayload,
  resolveStewardTarget,
} from "./shared.ts";

export const commandStewardContext = Command.make(
  "steward-context",
  {
    payloadPath: payloadFlag,
    projectRoot: projectRootFlag,
    vault: optionalVaultFlag,
    project: optionalProjectFlag,
  },
  Effect.fnUntraced(function* ({ payloadPath, projectRoot, vault, project }) {
    const root = yield* commandRoot;
    const payload = yield* readPayload(payloadPath);
    const target = yield* resolveStewardTarget({ vault, project, projectRoot });
    const result = yield* buildStewardContext({
      payload,
      vaultPath: target.vaultPath,
      projectSlug: target.projectSlug,
      payloadWarnings: [],
    }).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "StewardContextFailed",
          message: cause.message,
        }),
      ),
    );
    const jsonText = yield* encodeStewardContextResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode steward context result: ${cause.message}`,
        }),
      ),
    );

    return yield* Console.log(
      root.json ? jsonText : `Steward context ready for ${result.payload.projectSlug}`,
    );
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Build the active-agent Memory Steward context bundle"),
  Command.withExamples([
    {
      command: "agentic-memory steward-context --payload - --project-root . --json",
      description: "Read a capture payload from stdin and resolve the project link",
    },
    {
      command:
        "agentic-memory steward-context --payload payload.json --vault /vault --project example-project --json",
      description: "Build context using a direct vault and project target",
    },
  ]),
);
