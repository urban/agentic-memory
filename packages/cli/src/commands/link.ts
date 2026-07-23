import { encodeLinkCommandResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import {
  decodeLinkConfig,
  loadLinkConfig,
  writeLinkConfig,
} from "@urban/agentic-memory-core/link/LinkConfig";
import { ensureGitExcludeEntry } from "@urban/agentic-memory-core/link/GitExclude";
import { decodeProjectSlug } from "@urban/agentic-memory-core/link/ProjectSlug";
import {
  ensureMemoryRoute,
  ensureProjectFile,
  formatIsoDateFromMillis,
} from "@urban/agentic-memory-core/vault/ProjectRoute";
import { validateVaultForLink } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Clock, Console, Effect, Exit, FileSystem, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";
import { commandRoot } from "./root.ts";

type LinkCommandResult = import("@urban/agentic-memory-core/cli/CliResults").LinkCommandResult;

const configsMatch = (
  left: LinkCommandResult["config"],
  right: LinkCommandResult["config"],
): boolean => left.vaultPath === right.vaultPath && left.projectSlug === right.projectSlug;

export const commandLink = Command.make(
  "link",
  {
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Agentic Memory vault path, resolved from the effective directory"),
    ),
    project: Flag.string("project").pipe(
      Flag.withDescription("Bare lowercase Agentic Memory project slug"),
    ),
    yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm overwriting a differing link")),
  },
  Effect.fnUntraced(function* ({ vaultPath: rawVaultPath, project, yes }) {
    const root = yield* commandRoot;
    const fs = yield* FileSystem.FileSystem;
    const projectRoot = root.directory.path;
    const vaultPath = yield* resolvePathInput(root.directory.path, rawVaultPath, "Vault path");
    const projectSlug = yield* decodeProjectSlug(project).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "InvalidProjectSlug",
          message: `Invalid project slug: ${cause.message}`,
        }),
      ),
    );
    yield* validateVaultForLink(vaultPath).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "InvalidVault",
          message: cause.message,
        }),
      ),
    );
    const config = yield* decodeLinkConfig({
      version: 1,
      vaultPath,
      projectSlug,
    }).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "InvalidLinkConfig",
          message: `Invalid link config: ${cause.message}`,
        }),
      ),
    );

    const existing = yield* loadLinkConfig(projectRoot);
    const existingMatches = existing._tag === "valid" && configsMatch(existing.config, config);
    const overwriteNeeded =
      existing._tag === "invalid" || (existing._tag === "valid" && !existingMatches);
    if (overwriteNeeded && !yes) {
      return yield* toFailure({
        code: "ConfirmationRequired",
        message:
          "Existing .agentic-memory-link/config.json differs or is invalid; rerun with --yes after confirming overwrite.",
      });
    }

    const date = yield* Clock.clockWith((clock) =>
      Effect.sync(() => formatIsoDateFromMillis(clock.currentTimeMillisUnsafe())),
    );
    const rollbackWrittenConfig = (configPath: string, previousContents: string | undefined) =>
      (previousContents === undefined
        ? fs.remove(configPath, { force: true })
        : fs.writeFileString(configPath, previousContents)
      ).pipe(Effect.ignore);
    const finalizeLink = (configPath: string) =>
      Effect.gen(function* () {
        const createdProjectFile = yield* ensureProjectFile({
          vaultPath: config.vaultPath,
          projectSlug: config.projectSlug,
          date,
        }).pipe(
          Effect.mapError((cause) =>
            toFailure({ code: "ProjectFileFailed", message: cause.message }),
          ),
        );
        const updatedMemoryRoute = yield* ensureMemoryRoute({
          vaultPath: config.vaultPath,
          projectSlug: config.projectSlug,
          date,
        }).pipe(
          Effect.mapError((cause) =>
            toFailure({ code: "MemoryRouteFailed", message: cause.message }),
          ),
        );
        const gitExclude = yield* ensureGitExcludeEntry(projectRoot).pipe(
          Effect.mapError((cause) =>
            toFailure({ code: "GitExcludeFailed", message: cause.message }),
          ),
        );

        return {
          configPath,
          createdProjectFile,
          updatedMemoryRoute,
          updatedGitExclude: gitExclude.updated,
          warnings: gitExclude.warning === undefined ? [] : [gitExclude.warning],
        };
      });
    const linkChanges = yield* existingMatches
      ? finalizeLink(existing.paths.configFile).pipe(
          Effect.map((result) => ({
            ...result,
            wroteConfig: false,
          })),
        )
      : Effect.acquireUseRelease(
          Effect.gen(function* () {
            const previousContents = Option.getOrUndefined(
              yield* fs.readFileString(existing.paths.configFile).pipe(Effect.option),
            );
            const paths = yield* writeLinkConfig(projectRoot, config).pipe(
              Effect.mapError((cause) =>
                toFailure({ code: "WriteConfigFailed", message: cause.message }),
              ),
            );

            return {
              configPath: paths.configFile,
              previousContents,
            };
          }),
          ({ configPath }) =>
            finalizeLink(configPath).pipe(
              Effect.map((result) => ({
                ...result,
                wroteConfig: true,
              })),
            ),
          ({ configPath, previousContents }, exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : rollbackWrittenConfig(configPath, previousContents),
        );
    const result: LinkCommandResult = {
      status: "linked",
      projectRoot,
      configPath: linkChanges.configPath,
      config,
      changes: {
        wroteConfig: linkChanges.wroteConfig,
        createdProjectFile: linkChanges.createdProjectFile,
        updatedMemoryRoute: linkChanges.updatedMemoryRoute,
        updatedGitExclude: linkChanges.updatedGitExclude,
      },
      warnings: linkChanges.warnings,
    };
    const jsonText = yield* encodeLinkCommandResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode link result: ${cause.message}`,
        }),
      ),
    );

    return yield* Console.log(
      root.json
        ? jsonText
        : `Linked ${projectRoot} to ${config.vaultPath} as ${config.projectSlug}`,
    );
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Link a project root to an Agentic Memory vault project"),
  Command.withExamples([
    {
      command:
        "agentic-memory -C /absolute/path/to/project link --vault ../vault --project example-project --yes --json",
      description: "Resolve the vault from the project working context and create the local link",
    },
  ]),
);
