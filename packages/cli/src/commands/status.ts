import {
  encodeSemanticIndexReadinessJson,
  encodeStatusCommandResultJson,
} from "@urban/agentic-memory-core/cli/CliResults";
import { loadLinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { inspectSemanticIndex } from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { checkVaultHealth } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
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
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Absolute path to an initialized Agentic Memory vault"),
      Flag.optional,
    ),
  },
  Effect.fnUntraced(function* ({ projectRoot: rawProjectRoot, vaultPath }) {
    const root = yield* commandRoot;
    if (Option.isSome(vaultPath)) {
      const result = yield* inspectSemanticIndex(vaultPath.value).pipe(
        Effect.mapError((cause) =>
          toFailure({
            code: cause.reason,
            message: cause.message,
          }),
        ),
      );
      const jsonText = yield* encodeSemanticIndexReadinessJson(result).pipe(
        Effect.mapError((cause) =>
          toFailure({
            code: "EncodeResultFailed",
            message: `Failed to encode semantic readiness result: ${cause.message}`,
          }),
        ),
      );
      const human = [
        `Agentic Memory vault status: ${result.status}`,
        `Vault: ${result.vault.status}`,
        `Model: ${result.model.status}`,
        `Index: ${result.index.status} (${result.index.newFiles} new, ${result.index.changedFiles} changed, ${result.index.deletedFiles} deleted, ${result.index.unchangedFiles} unchanged)`,
        `Recall ready: ${result.recallReady ? "yes" : "no"}`,
        ...result.warnings.map((warning) => `Warning: ${warning}`),
      ].join("\n");
      return yield* Console.log(root.json ? jsonText : human);
    }
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
  Command.withDescription("Inspect a vault's semantic readiness or a project-local memory link"),
  Command.withExamples([
    {
      command: "agentic-memory status --vault /absolute/path/to/vault --json",
      description: "Inspect semantic recall readiness without changing the vault or model cache",
    },
    {
      command: "agentic-memory status --project-root . --json",
      description: "Inspect link status as JSON without searching ancestor directories",
    },
  ]),
);
