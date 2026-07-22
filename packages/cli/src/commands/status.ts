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
import { resolvePathInput } from "./path-input.ts";
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
      Flag.withDescription("Vault path for read-only local model and semantic index readiness"),
      Flag.optional,
    ),
  },
  Effect.fnUntraced(function* ({ projectRoot: rawProjectRoot, vaultPath }) {
    const root = yield* commandRoot;
    if (Option.isSome(vaultPath)) {
      const resolvedVaultPath = yield* resolvePathInput(
        root.directory,
        vaultPath.value,
        "Vault path",
      );
      const result = yield* inspectSemanticIndex(resolvedVaultPath).pipe(
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
  Command.withDescription(
    "Inspect read-only vault semantic readiness or project-local link health",
  ),
  Command.withExamples([
    {
      command: "agentic-memory -C /absolute/path/to status --vault vault --json",
      description: "Resolve a relative vault path and inspect semantic recall readiness",
    },
    {
      command: "agentic-memory status --project-root . --json",
      description: "Inspect link status as JSON without searching ancestor directories",
    },
  ]),
);
