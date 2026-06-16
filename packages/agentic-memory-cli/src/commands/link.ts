import {
  encodeLinkCommandResultJson,
  type LinkCommandResult,
} from "@urban/agentic-memory-core/cli/CliResults";
import {
  decodeLinkConfig,
  loadLinkConfig,
  writeLinkConfig,
} from "@urban/agentic-memory-core/link/LinkConfig";
import { decodeProjectSlug } from "@urban/agentic-memory-core/link/ProjectSlug";
import {
  ensureGitExcludeEntry,
  ensureMemoryRoute,
  ensureProjectFile,
  formatIsoDateFromMillis,
} from "@urban/agentic-memory-core/vault/ProjectRoute";
import { validateVaultForLink } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Clock, Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { commandRoot } from "./root.ts";
import { projectRootFlag, resolveProjectRoot } from "./shared.ts";

const configsMatch = (
  left: LinkCommandResult["config"],
  right: LinkCommandResult["config"],
): boolean => left.vaultPath === right.vaultPath && left.projectSlug === right.projectSlug;

export const commandLink = Command.make(
  "link",
  {
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Absolute path to the Agentic Memory vault"),
    ),
    project: Flag.string("project").pipe(
      Flag.withDescription("Bare lowercase Agentic Memory project slug"),
    ),
    projectRoot: projectRootFlag,
    yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm overwriting a differing link")),
  },
  Effect.fnUntraced(function* ({ vaultPath, project, projectRoot: rawProjectRoot, yes }) {
    const root = yield* commandRoot;
    const projectRoot = yield* resolveProjectRoot(rawProjectRoot);
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

    const paths = existingMatches
      ? existing.paths
      : yield* writeLinkConfig(projectRoot, config).pipe(
          Effect.mapError((cause) =>
            toFailure({ code: "WriteConfigFailed", message: cause.message }),
          ),
        );
    const date = yield* Clock.clockWith((clock) =>
      Effect.sync(() => formatIsoDateFromMillis(clock.currentTimeMillisUnsafe())),
    );
    const createdProjectFile = yield* ensureProjectFile({
      vaultPath: config.vaultPath,
      projectSlug: config.projectSlug,
      date,
    }).pipe(
      Effect.mapError((cause) => toFailure({ code: "ProjectFileFailed", message: cause.message })),
    );
    const updatedMemoryRoute = yield* ensureMemoryRoute({
      vaultPath: config.vaultPath,
      projectSlug: config.projectSlug,
      date,
    }).pipe(
      Effect.mapError((cause) => toFailure({ code: "MemoryRouteFailed", message: cause.message })),
    );
    const gitExclude = yield* ensureGitExcludeEntry(projectRoot).pipe(
      Effect.mapError((cause) => toFailure({ code: "GitExcludeFailed", message: cause.message })),
    );
    const warnings = gitExclude.warning === undefined ? [] : [gitExclude.warning];
    const result: LinkCommandResult = {
      status: "linked",
      projectRoot,
      configPath: paths.configFile,
      config,
      changes: {
        wroteConfig: !existingMatches,
        createdProjectFile,
        updatedMemoryRoute,
        updatedGitExclude: gitExclude.updated,
      },
      warnings,
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
        "agentic-memory link --vault /absolute/path/to/vault --project example-project --project-root . --yes --json",
      description: "Create or update the project-local link config",
    },
  ]),
);
