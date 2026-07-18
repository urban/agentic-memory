import {
  ensureMemoryRoute as ensureCoreMemoryRoute,
  ensureProjectFile as ensureCoreProjectFile,
} from "@urban/agentic-memory-core/vault/ProjectRoute";
import { LinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { validateVaultForLink } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";

export class VaultProjectsServiceError extends Schema.TaggedErrorClass<VaultProjectsServiceError>()(
  "VaultProjectsServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class VaultProjects extends Context.Service<
  VaultProjects,
  {
    readonly validateTarget: (
      config: LinkConfig,
    ) => Effect.Effect<LinkConfig, VaultProjectsServiceError>;
    readonly projectFilePath: (
      config: LinkConfig,
    ) => Effect.Effect<string, VaultProjectsServiceError>;
    readonly projectExists: (
      config: LinkConfig,
    ) => Effect.Effect<boolean, VaultProjectsServiceError>;
    readonly ensureProjectFile: (
      config: LinkConfig,
      date: string,
    ) => Effect.Effect<boolean, VaultProjectsServiceError>;
    readonly ensureMemoryRoute: (
      config: LinkConfig,
      date: string,
    ) => Effect.Effect<boolean, VaultProjectsServiceError>;
  }
>()("@urban/pi-memory-capture/services/VaultProjects") {
  static readonly layer = Layer.effect(
    VaultProjects,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const validateTarget = Effect.fn("VaultProjects.validateTarget")(function* (
        config: LinkConfig,
      ) {
        yield* validateVaultForLink(config.vaultPath).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: cause.message,
                cause,
              }),
          ),
        );
        return LinkConfig.make(config);
      });

      const projectFilePath = Effect.fn("VaultProjects.projectFilePath")((config: LinkConfig) =>
        Effect.succeed(path.join(config.vaultPath, "projects", `${config.projectSlug}.md`)),
      );

      const projectExists = Effect.fn("VaultProjects.projectExists")(function* (
        config: LinkConfig,
      ) {
        const filepath = yield* projectFilePath(config);
        return yield* fs.exists(filepath).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to inspect project file: ${filepath}`,
                cause,
              }),
          ),
        );
      });

      const ensureProjectFile = Effect.fn("VaultProjects.ensureProjectFile")(function* (
        config: LinkConfig,
        date: string,
      ) {
        return yield* ensureCoreProjectFile({
          vaultPath: config.vaultPath,
          projectSlug: config.projectSlug,
          date,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: cause.message,
                cause,
              }),
          ),
        );
      });

      const ensureMemoryRoute = Effect.fn("VaultProjects.ensureMemoryRoute")(function* (
        config: LinkConfig,
        date: string,
      ) {
        return yield* ensureCoreMemoryRoute({
          vaultPath: config.vaultPath,
          projectSlug: config.projectSlug,
          date,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: cause.message,
                cause,
              }),
          ),
        );
      });

      return VaultProjects.of({
        validateTarget,
        projectFilePath,
        projectExists,
        ensureProjectFile,
        ensureMemoryRoute,
      });
    }),
  );
}
