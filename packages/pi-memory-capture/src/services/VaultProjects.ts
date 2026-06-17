import {
  ensureMemoryRoute as ensureCoreMemoryRoute,
  ensureProjectFile as ensureCoreProjectFile,
} from "@urban/agentic-memory-core/vault/ProjectRoute";
import { validateVaultForLink } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ResolvedProjectConfig } from "../schema.ts";

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
      config: ResolvedProjectConfig,
    ) => Effect.Effect<ResolvedProjectConfig, VaultProjectsServiceError>;
    readonly projectFilePath: (
      config: ResolvedProjectConfig,
    ) => Effect.Effect<string, VaultProjectsServiceError>;
    readonly projectExists: (
      config: ResolvedProjectConfig,
    ) => Effect.Effect<boolean, VaultProjectsServiceError>;
    readonly ensureProjectFile: (
      config: ResolvedProjectConfig,
      date: string,
    ) => Effect.Effect<boolean, VaultProjectsServiceError>;
    readonly ensureMemoryRoute: (
      config: ResolvedProjectConfig,
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
        config: ResolvedProjectConfig,
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
        return ResolvedProjectConfig.make(config);
      });

      const projectFilePath = Effect.fn("VaultProjects.projectFilePath")(
        (config: ResolvedProjectConfig) =>
          Effect.succeed(path.join(config.vaultPath, "projects", `${config.projectSlug}.md`)),
      );

      const projectExists = Effect.fn("VaultProjects.projectExists")(function* (
        config: ResolvedProjectConfig,
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
        config: ResolvedProjectConfig,
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
        config: ResolvedProjectConfig,
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
