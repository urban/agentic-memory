import { encodeStatusCommandResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import { loadLinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { checkVaultHealth } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { projectRootFlag, resolveProjectRoot } from "./project-root-input.ts";
import { commandRoot } from "./root.ts";

const buildStatusResult = Effect.fnUntraced(function* (projectRoot: string) {
  const loaded = yield* loadLinkConfig(projectRoot);
  switch (loaded._tag) {
    case "missing":
      return {
        status: "unlinked",
        projectRoot,
        link: {
          exists: false,
          path: loaded.paths.configFile,
        },
        warnings: [],
      };
    case "invalid":
      return {
        status: "unhealthy",
        projectRoot,
        link: {
          exists: true,
          path: loaded.paths.configFile,
          message: loaded.message,
        },
        warnings: [loaded.message],
      };
    case "valid": {
      const health = yield* checkVaultHealth({
        vaultPath: loaded.config.vaultPath,
        projectSlug: loaded.config.projectSlug,
      });
      return {
        status: health.healthy ? "healthy" : "unhealthy",
        projectRoot,
        link: {
          exists: true,
          path: loaded.paths.configFile,
          config: loaded.config,
        },
        vault: {
          path: health.path,
          healthy: health.healthy,
          projectFileExists: health.projectFileExists,
          memoryRouteExists: health.memoryRouteExists,
          details: health,
        },
        warnings: health.healthy ? [] : ["Linked vault is unhealthy for this project."],
      };
    }
  }
});

export const commandStatus = Command.make(
  "status",
  {
    projectRoot: projectRootFlag,
  },
  Effect.fnUntraced(function* ({ projectRoot: rawProjectRoot }) {
    const root = yield* commandRoot;
    const projectRoot = yield* resolveProjectRoot(rawProjectRoot);
    const result = yield* buildStatusResult(projectRoot);
    const jsonText = yield* encodeStatusCommandResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode status result: ${cause.message}`,
        }),
      ),
    );

    return yield* Console.log(root.json ? jsonText : `Agentic Memory status: ${result.status}`);
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Inspect the project-local Agentic Memory link and linked vault health"),
  Command.withExamples([
    {
      command: "agentic-memory status --project-root . --json",
      description: "Inspect link status as JSON without searching ancestor directories",
    },
  ]),
);
