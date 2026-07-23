import {
  buildStewardContext,
  encodeStewardContextResultJson,
} from "@urban/agentic-memory-core/steward/StewardContext";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { payloadFlag, readPayload } from "./payload-input.ts";
import { compatibilityProjectRootFlag } from "./project-root-input.ts";
import { commandRoot } from "./root.ts";
import {
  optionalProjectFlag,
  optionalVaultFlag,
  resolveStewardTarget,
} from "./steward-target-input.ts";

export const commandStewardContext = Command.make(
  "steward-context",
  {
    payloadPath: payloadFlag,
    projectRoot: compatibilityProjectRootFlag,
    vault: optionalVaultFlag,
    project: optionalProjectFlag,
  },
  Effect.fnUntraced(function* ({ payloadPath, projectRoot, vault, project }) {
    const root = yield* commandRoot;
    const payload = yield* readPayload(root.directory.path, payloadPath);
    const target = yield* resolveStewardTarget({
      vault,
      project,
      directory: root.directory,
      projectRoot,
    });
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
      command: "agentic-memory -C . steward-context --payload - --json",
      description: "Read a capture payload from stdin and resolve the project link",
    },
    {
      command:
        "agentic-memory -C /work steward-context --payload payload.json --vault ../vault --project example-project --json",
      description: "Build context using a direct vault and project target",
    },
  ]),
);
