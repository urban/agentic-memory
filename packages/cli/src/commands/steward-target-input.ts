import { loadLinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { decodeProjectSlug } from "@urban/agentic-memory-core/link/ProjectSlug";
import { Effect, FileSystem, Option, Path } from "effect";
import { Flag } from "effect/unstable/cli";
import { toFailure } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";

type ProjectSlug = import("@urban/agentic-memory-core/link/ProjectSlug").ProjectSlug;
type AbsolutePath = import("@urban/agentic-memory-core/link/LinkConfig").AbsolutePath;
type CliCommandFailure = import("../output.ts").CliCommandFailure;
type InvocationDirectory = import("./path-input.ts").InvocationDirectory;

export interface ResolvedStewardTarget {
  readonly vaultPath: AbsolutePath;
  readonly projectSlug: ProjectSlug;
}

export const optionalVaultFlag = Flag.string("vault").pipe(
  Flag.withDescription("Agentic Memory vault path for direct mode"),
  Flag.optional,
);

export const optionalProjectFlag = Flag.string("project").pipe(
  Flag.withDescription("Agentic Memory project slug for direct mode"),
  Flag.optional,
);

const decodeCliProjectSlug = (project: string): Effect.Effect<ProjectSlug, CliCommandFailure> =>
  decodeProjectSlug(project).pipe(
    Effect.mapError((cause) =>
      toFailure({
        code: "InvalidProjectSlug",
        message: `Invalid project slug: ${cause.message}`,
      }),
    ),
  );

export const resolveStewardTarget: (input: {
  readonly vault: Option.Option<string>;
  readonly project: Option.Option<string>;
  readonly directory: InvocationDirectory;
}) => Effect.Effect<ResolvedStewardTarget, CliCommandFailure, FileSystem.FileSystem | Path.Path> =
  Effect.fnUntraced(function* (input) {
    if (Option.isSome(input.vault) || Option.isSome(input.project)) {
      if (Option.isNone(input.vault) || Option.isNone(input.project)) {
        return yield* toFailure({
          code: "InvalidTarget",
          message: "Direct mode requires both --vault and --project",
        });
      }

      const projectSlug = yield* decodeCliProjectSlug(input.project.value);
      const vaultPath = yield* resolvePathInput(
        input.directory.path,
        input.vault.value,
        "Vault path",
      );
      return {
        vaultPath,
        projectSlug,
      };
    }

    const loaded = yield* loadLinkConfig(input.directory.path);
    switch (loaded._tag) {
      case "missing":
        return yield* toFailure({
          code: "MissingLinkConfig",
          message: `Missing .agentic-memory-link/config.json at ${loaded.paths.configFile}`,
        });
      case "invalid":
        return yield* toFailure({
          code: "InvalidLinkConfig",
          message: loaded.message,
        });
      case "valid":
        return {
          vaultPath: loaded.config.vaultPath,
          projectSlug: loaded.config.projectSlug,
        };
    }
  });
