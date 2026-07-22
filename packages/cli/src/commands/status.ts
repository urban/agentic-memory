import {
  encodeStatusCommandResultJson,
  StatusCommandResult,
} from "@urban/agentic-memory-core/cli/CliResults";
import { decodeAbsolutePath, loadLinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { inspectSemanticIndex } from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { checkVaultHealth } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Console, Effect, FileSystem, Option, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";
import {
  compatibilityProjectRootFlag,
  resolveCompatibilityProjectRoot,
} from "./project-root-input.ts";
import { commandRoot } from "./root.ts";

type AbsolutePath = import("@urban/agentic-memory-core/link/LinkConfig").AbsolutePath;
type SemanticIndexReadiness =
  import("@urban/agentic-memory-core/semantic/SemanticIndex").SemanticIndexReadiness;
type StatusResult = import("@urban/agentic-memory-core/cli/CliResults").StatusCommandResult;

const inspectReadiness = (vaultPath: AbsolutePath) =>
  inspectSemanticIndex(vaultPath).pipe(
    Effect.mapError((cause) =>
      toFailure({
        code: cause.reason,
        message: cause.message,
      }),
    ),
  );

const decodeStatusAbsolutePath = (input: string) =>
  decodeAbsolutePath(input).pipe(
    Effect.mapError((cause) =>
      toFailure({
        code: "InvalidStatusPath",
        message: `Status path is invalid: ${cause.message}`,
      }),
    ),
  );

const inspectVault = Effect.fnUntraced(function* (vaultPath: AbsolutePath) {
  const readiness = yield* inspectReadiness(vaultPath);
  return StatusCommandResult.make({
    _tag: "vault",
    version: 1,
    directory: vaultPath,
    readiness,
  });
});

const hasVaultControlPlane = Effect.fnUntraced(function* (
  directory: AbsolutePath,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs
    .exists(path.join(directory, ".agentic-memory"))
    .pipe(Effect.orElseSucceed(() => false));
});

const inspectWorkingContext = Effect.fnUntraced(function* (directory: AbsolutePath) {
  const loaded = yield* loadLinkConfig(directory);
  if (loaded._tag === "invalid") {
    return StatusCommandResult.make({
      _tag: "linked-project",
      version: 1,
      status: "unhealthy",
      directory,
      inspection: {
        _tag: "invalid-link",
        link: {
          path: yield* decodeStatusAbsolutePath(loaded.paths.configFile),
          message: loaded.message,
        },
      },
      warnings: [loaded.message],
    });
  }

  const isVault = yield* hasVaultControlPlane(directory);
  if (loaded._tag === "valid") {
    if (isVault) {
      return yield* toFailure({
        code: "AmbiguousStatusContext",
        message: `Directory is both an Agentic Memory vault and a linked project: ${directory}`,
        exitCode: 2,
      });
    }

    const projectRoute = yield* checkVaultHealth({
      vaultPath: loaded.config.vaultPath,
      projectSlug: loaded.config.projectSlug,
    });
    const semanticReadiness = yield* inspectReadiness(loaded.config.vaultPath);
    const warnings = [
      ...(projectRoute.healthy ? [] : ["Linked vault project route is unhealthy."]),
      ...semanticReadiness.warnings,
    ];
    return StatusCommandResult.make({
      _tag: "linked-project",
      version: 1,
      status: projectRoute.healthy ? "healthy" : "unhealthy",
      directory,
      inspection: {
        _tag: "valid-link",
        link: {
          path: yield* decodeStatusAbsolutePath(loaded.paths.configFile),
          config: loaded.config,
        },
        projectRoute,
        semanticReadiness,
      },
      warnings,
    });
  }

  if (isVault) {
    return yield* inspectVault(directory);
  }

  return StatusCommandResult.make({
    _tag: "unconfigured",
    version: 1,
    status: "unconfigured",
    directory,
    expectedLinkPath: yield* decodeStatusAbsolutePath(loaded.paths.configFile),
    warnings: [],
  });
});

const formatReadiness = (readiness: SemanticIndexReadiness): string =>
  [
    `Agentic Memory vault status: ${readiness.status}`,
    `Vault: ${readiness.vault.status}`,
    `Model: ${readiness.model.status}`,
    `Index: ${readiness.index.status} (${readiness.index.newFiles} new, ${readiness.index.changedFiles} changed, ${readiness.index.deletedFiles} deleted, ${readiness.index.unchangedFiles} unchanged)`,
    `Recall ready: ${readiness.recallReady ? "yes" : "no"}`,
    ...readiness.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");

const formatHuman = (result: StatusResult): string => {
  switch (result._tag) {
    case "vault":
      return formatReadiness(result.readiness);
    case "unconfigured":
      return `Agentic Memory status: unconfigured\nDirectory: ${result.directory}`;
    case "linked-project":
      if (result.inspection._tag === "invalid-link") {
        return `Agentic Memory linked-project status: unhealthy\nLink: invalid\nWarning: ${result.inspection.link.message}`;
      }
      return [
        `Agentic Memory linked-project status: ${result.status}`,
        `Project route: ${result.inspection.projectRoute.healthy ? "healthy" : "unhealthy"}`,
        `Linked vault semantic status: ${result.inspection.semanticReadiness.status}`,
        `Recall ready: ${result.inspection.semanticReadiness.recallReady ? "yes" : "no"}`,
        ...result.warnings.map((warning) => `Warning: ${warning}`),
      ].join("\n");
  }
};

export const commandStatus = Command.make(
  "status",
  {
    projectRoot: compatibilityProjectRootFlag,
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Vault path for read-only local model and semantic index readiness"),
      Flag.optional,
    ),
  },
  Effect.fnUntraced(function* ({ projectRoot, vaultPath }) {
    const root = yield* commandRoot;
    const compatibilityDirectory = yield* resolveCompatibilityProjectRoot(
      root.directory,
      projectRoot,
    );

    const result = Option.isSome(vaultPath)
      ? yield* resolvePathInput(root.directory.path, vaultPath.value, "Vault path").pipe(
          Effect.flatMap(inspectVault),
        )
      : yield* inspectWorkingContext(compatibilityDirectory);
    const jsonText = yield* encodeStatusCommandResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode status result: ${cause.message}`,
        }),
      ),
    );

    return yield* Console.log(root.json ? jsonText : formatHuman(result));
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Inspect the Agentic Memory context at the effective directory"),
  Command.withExamples([
    {
      command: "agentic-memory -C /absolute/path/to/vault status --json",
      description: "Inspect the exact vault or linked-project context at a directory",
    },
    {
      command: "agentic-memory -C /absolute/path/to status --vault vault --json",
      description: "Resolve an explicit relative vault before contextual status detection",
    },
  ]),
);
