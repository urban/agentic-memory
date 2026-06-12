import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  applyProjectTemplate,
  buildBuiltinProjectScaffold,
  ensureProjectRouteInMemory,
  isAbsolutePath,
  isProjectLink,
  projectLabelFromLink,
  projectSlugFromLink,
} from "../project.ts";
import { ResolvedProjectConfig } from "../schema.ts";

export class VaultProjectsServiceError extends Schema.TaggedErrorClass<VaultProjectsServiceError>()(
  "VaultProjectsServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

const outsideVaultContractPath = (path: Path.Path, vaultPath: string): string =>
  path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md");

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
      ): Effect.fn.Return<ResolvedProjectConfig, VaultProjectsServiceError> {
        const { vaultPath, projectLink } = config;

        if (!isAbsolutePath(vaultPath)) {
          return yield* new VaultProjectsServiceError({
            message: `Vault path must be absolute: ${vaultPath}`,
          });
        }

        if (!isProjectLink(projectLink)) {
          return yield* new VaultProjectsServiceError({
            message: `Project link must match [[projects/<slug>]]: ${projectLink}`,
          });
        }

        const contractPath = outsideVaultContractPath(path, vaultPath);
        const contractExists = yield* fs.exists(contractPath).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to validate vault contract path: ${contractPath}`,
                cause,
              }),
          ),
        );

        if (!contractExists) {
          return yield* new VaultProjectsServiceError({
            message: `Vault path does not contain .agentic-memory/LLM-outside-vault.md: ${vaultPath}`,
          });
        }

        return ResolvedProjectConfig.make(config);
      });

      const projectFilePath = Effect.fn("VaultProjects.projectFilePath")(function* (
        config: ResolvedProjectConfig,
      ): Effect.fn.Return<string, VaultProjectsServiceError> {
        const { vaultPath, projectLink } = config;
        const slugOption = projectSlugFromLink(projectLink);
        if (Option.isNone(slugOption)) {
          return yield* new VaultProjectsServiceError({
            message: `Project link must match [[projects/<slug>]]: ${projectLink}`,
          });
        }

        return path.join(vaultPath, "projects", `${slugOption.value}.md`);
      });

      const projectExists = Effect.fn("VaultProjects.projectExists")(function* (
        config: ResolvedProjectConfig,
      ): Effect.fn.Return<boolean, VaultProjectsServiceError> {
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
      ): Effect.fn.Return<boolean, VaultProjectsServiceError> {
        const filepath = yield* projectFilePath(config);
        const alreadyExists = yield* fs.exists(filepath).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to inspect project file: ${filepath}`,
                cause,
              }),
          ),
        );

        if (alreadyExists) {
          return false;
        }

        const templatePath = path.join(
          config.vaultPath,
          ".agentic-memory",
          "templates",
          "project.md",
        );
        const templateExists = yield* fs.exists(templatePath).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to inspect project template: ${templatePath}`,
                cause,
              }),
          ),
        );
        const projectLabel = projectLabelFromLink(config.projectLink);
        const templateDocument = templateExists
          ? yield* fs.readFileString(templatePath).pipe(
              Effect.mapError(
                (cause) =>
                  new VaultProjectsServiceError({
                    message: `Failed to read project template: ${templatePath}`,
                    cause,
                  }),
              ),
            )
          : undefined;

        const scaffold = Option.getOrElse(
          templateDocument === undefined
            ? Option.none()
            : applyProjectTemplate(templateDocument, { projectLabel, date }),
          () => buildBuiltinProjectScaffold({ projectLabel, date }),
        );

        yield* fs.makeDirectory(path.dirname(filepath), { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to create project directory for: ${filepath}`,
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(filepath, scaffold).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to write project file: ${filepath}`,
                cause,
              }),
          ),
        );

        return true;
      });

      const ensureMemoryRoute = Effect.fn("VaultProjects.ensureMemoryRoute")(function* (
        config: ResolvedProjectConfig,
        date: string,
      ): Effect.fn.Return<boolean, VaultProjectsServiceError> {
        const memoryPath = path.join(config.vaultPath, "MEMORY.md");
        const contents = yield* fs.readFileString(memoryPath).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to read vault MEMORY.md: ${memoryPath}`,
                cause,
              }),
          ),
        );
        const updated = ensureProjectRouteInMemory(
          contents,
          config.projectLink,
          projectLabelFromLink(config.projectLink),
          date,
        );

        if (updated === contents) {
          return false;
        }

        yield* fs.writeFileString(memoryPath, updated).pipe(
          Effect.mapError(
            (cause) =>
              new VaultProjectsServiceError({
                message: `Failed to update vault MEMORY.md: ${memoryPath}`,
                cause,
              }),
          ),
        );
        return true;
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
