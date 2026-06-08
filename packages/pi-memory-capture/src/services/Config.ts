import {
  Config as EffectConfig,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import {
  CAPTURE_DIRECTORY,
  CONFIG_FILENAME,
  GIT_EXCLUDE_ENTRY,
  SCRATCHPAD_FILENAME,
} from "../constants.ts";
import {
  applyProjectTemplate,
  buildBuiltinProjectScaffold,
  ensureProjectRouteInMemory,
  isAbsolutePath,
  isProjectLink,
  projectLabelFromLink,
  projectSlugFromLink,
} from "../project.ts";
import {
  decodeProjectConfigJson,
  encodeProjectConfigJson,
  type ResolvedProjectConfig,
} from "../schema.ts";

export class ConfigServiceError extends Schema.TaggedErrorClass<ConfigServiceError>()(
  "ConfigServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface LocalPaths {
  readonly directory: string;
  readonly configFile: string;
  readonly scratchpadFile: string;
}

export type LoadConfigResult =
  | {
      readonly _tag: "missing";
      readonly paths: LocalPaths;
    }
  | {
      readonly _tag: "invalid";
      readonly paths: LocalPaths;
      readonly message: string;
    }
  | {
      readonly _tag: "valid";
      readonly paths: LocalPaths;
      readonly config: ResolvedProjectConfig;
    };

export interface EnvironmentOverrides {
  readonly vaultOverride: string | undefined;
  readonly piBinary: string | undefined;
}

const outsideVaultContractPath = (path: Path.Path, vaultPath: string): string =>
  path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md");

const optionalEnvironmentVariable = Effect.fn("Config.optionalEnvironmentVariable")(
  function* (name: string) {
    const value = yield* EffectConfig.string(name).pipe(EffectConfig.option);
    return Option.getOrUndefined(value);
  },
  Effect.catch(() => Effect.sync((): string | undefined => undefined)),
);

export class Config extends Context.Service<
  Config,
  {
    readonly environmentOverrides: Effect.Effect<EnvironmentOverrides>;
    readonly localPaths: (cwd: string) => Effect.Effect<LocalPaths>;
    readonly load: (cwd: string) => Effect.Effect<LoadConfigResult>;
    readonly validateInputs: (
      vaultPath: string,
      projectLink: string,
    ) => Effect.Effect<ResolvedProjectConfig, ConfigServiceError>;
    readonly projectFilePath: (
      vaultPath: string,
      projectLink: string,
    ) => Effect.Effect<string, ConfigServiceError>;
    readonly projectExists: (
      vaultPath: string,
      projectLink: string,
    ) => Effect.Effect<boolean, ConfigServiceError>;
    readonly ensureLocalFiles: (
      cwd: string,
      config: ResolvedProjectConfig,
      scratchpadContents: string,
    ) => Effect.Effect<LocalPaths, ConfigServiceError>;
    readonly ensureProjectFile: (
      vaultPath: string,
      projectLink: string,
      date: string,
    ) => Effect.Effect<boolean, ConfigServiceError>;
    readonly ensureMemoryRoute: (
      vaultPath: string,
      projectLink: string,
      date: string,
    ) => Effect.Effect<boolean, ConfigServiceError>;
    readonly ensureGitExcludeEntry: (gitDir: string) => Effect.Effect<boolean, ConfigServiceError>;
  }
>()("@urban/pi-memory-capture/services/Config") {
  static readonly layer = Layer.effect(
    Config,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const environmentOverrides: Effect.Effect<EnvironmentOverrides> = Effect.all({
        vaultOverride: optionalEnvironmentVariable("AGENTIC_MEMORY_VAULT"),
        piBinary: optionalEnvironmentVariable("PI_MEMORY_CAPTURE_PI_BIN"),
      }).pipe(Effect.withSpan("Config.environmentOverrides"));

      const localPaths = Effect.fn("Config.localPaths")((cwd: string) => {
        const directory = path.join(cwd, CAPTURE_DIRECTORY);
        return Effect.succeed({
          directory,
          configFile: path.join(directory, CONFIG_FILENAME),
          scratchpadFile: path.join(directory, SCRATCHPAD_FILENAME),
        });
      });

      const validateInputs = Effect.fn("Config.validateInputs")(function* (
        vaultPath: string,
        projectLink: string,
      ): Effect.fn.Return<ResolvedProjectConfig, ConfigServiceError> {
        if (!isAbsolutePath(vaultPath)) {
          return yield* new ConfigServiceError({
            message: `Vault path must be absolute: ${vaultPath}`,
          });
        }

        if (!isProjectLink(projectLink)) {
          return yield* new ConfigServiceError({
            message: `Project link must match [[projects/<slug>]]: ${projectLink}`,
          });
        }

        const contractPath = outsideVaultContractPath(path, vaultPath);
        const contractExists = yield* fs.exists(contractPath).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to validate vault contract path: ${contractPath}`,
                cause,
              }),
          ),
        );

        if (!contractExists) {
          return yield* new ConfigServiceError({
            message: `Vault path does not contain .agentic-memory/LLM-outside-vault.md: ${vaultPath}`,
          });
        }

        return {
          version: 1,
          vaultPath,
          projectLink,
        };
      });

      const load = Effect.fn("Config.load")(function* (
        cwd: string,
      ): Effect.fn.Return<LoadConfigResult> {
        const paths = yield* localPaths(cwd);
        const exists = yield* fs
          .exists(paths.configFile)
          .pipe(Effect.catch(() => Effect.succeed(false)));
        const { vaultOverride } = yield* environmentOverrides;

        if (!exists) {
          return {
            _tag: "missing",
            paths,
          } satisfies LoadConfigResult;
        }

        const readResult = yield* fs.readFileString(paths.configFile).pipe(
          Effect.match({
            onFailure: (cause) => ({
              _tag: "invalid" as const,
              message: `Failed to read config file: ${paths.configFile}`,
              cause,
            }),
            onSuccess: (contents) => ({
              _tag: "contents" as const,
              contents,
            }),
          }),
        );

        if (readResult._tag === "invalid") {
          return {
            _tag: "invalid",
            paths,
            message: `${readResult.message}: ${String(readResult.cause)}`,
          };
        }

        const decodedResult = yield* decodeProjectConfigJson(readResult.contents).pipe(
          Effect.match({
            onFailure: (error) => ({
              _tag: "invalid" as const,
              message: `Invalid config JSON: ${error.message}`,
            }),
            onSuccess: (config) => ({
              _tag: "decoded" as const,
              config,
            }),
          }),
        );

        if (decodedResult._tag === "invalid") {
          return {
            _tag: "invalid",
            paths,
            message: decodedResult.message,
          };
        }

        return yield* validateInputs(
          vaultOverride ?? decodedResult.config.vaultPath,
          decodedResult.config.projectLink,
        ).pipe(
          Effect.match({
            onFailure: (error) =>
              ({
                _tag: "invalid",
                paths,
                message: error.message,
              }) satisfies LoadConfigResult,
            onSuccess: (config) =>
              ({
                _tag: "valid",
                paths,
                config,
              }) satisfies LoadConfigResult,
          }),
        );
      });

      const projectFilePath = Effect.fn("Config.projectFilePath")(function* (
        vaultPath: string,
        projectLink: string,
      ): Effect.fn.Return<string, ConfigServiceError> {
        const slugOption = projectSlugFromLink(projectLink);
        if (Option.isNone(slugOption)) {
          return yield* new ConfigServiceError({
            message: `Project link must match [[projects/<slug>]]: ${projectLink}`,
          });
        }

        return path.join(vaultPath, "projects", `${slugOption.value}.md`);
      });

      const projectExists = Effect.fn("Config.projectExists")(function* (
        vaultPath: string,
        projectLink: string,
      ): Effect.fn.Return<boolean, ConfigServiceError> {
        const filepath = yield* projectFilePath(vaultPath, projectLink);
        return yield* fs.exists(filepath).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to inspect project file: ${filepath}`,
                cause,
              }),
          ),
        );
      });

      const ensureLocalFiles = Effect.fn("Config.ensureLocalFiles")(function* (
        cwd: string,
        config: ResolvedProjectConfig,
        scratchpadContents: string,
      ): Effect.fn.Return<LocalPaths, ConfigServiceError> {
        const paths = yield* localPaths(cwd);
        yield* fs.makeDirectory(paths.directory, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to create local capture directory: ${paths.directory}`,
                cause,
              }),
          ),
        );

        const configContents = yield* encodeProjectConfigJson(config).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: "Failed to encode local config",
                cause,
              }),
          ),
        );

        yield* fs.writeFileString(paths.configFile, `${configContents}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to write config file: ${paths.configFile}`,
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(paths.scratchpadFile, `${scratchpadContents}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to write scratchpad file: ${paths.scratchpadFile}`,
                cause,
              }),
          ),
        );

        return paths;
      });

      const ensureProjectFile = Effect.fn("Config.ensureProjectFile")(function* (
        vaultPath: string,
        projectLink: string,
        date: string,
      ): Effect.fn.Return<boolean, ConfigServiceError> {
        const filepath = yield* projectFilePath(vaultPath, projectLink);
        const alreadyExists = yield* fs.exists(filepath).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to inspect project file: ${filepath}`,
                cause,
              }),
          ),
        );

        if (alreadyExists) {
          return false;
        }

        const templatePath = path.join(vaultPath, ".agentic-memory", "templates", "project.md");
        const templateExists = yield* fs
          .exists(templatePath)
          .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(false)));
        const projectLabel = projectLabelFromLink(projectLink);
        const templateDocument = templateExists
          ? yield* fs.readFileString(templatePath).pipe(
              Effect.mapError(
                (cause) =>
                  new ConfigServiceError({
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
              new ConfigServiceError({
                message: `Failed to create project directory for: ${filepath}`,
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(filepath, scaffold).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to write project file: ${filepath}`,
                cause,
              }),
          ),
        );

        return true;
      });

      const ensureMemoryRoute = Effect.fn("Config.ensureMemoryRoute")(function* (
        vaultPath: string,
        projectLink: string,
        date: string,
      ): Effect.fn.Return<boolean, ConfigServiceError> {
        const memoryPath = path.join(vaultPath, "MEMORY.md");
        const contents = yield* fs.readFileString(memoryPath).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to read vault MEMORY.md: ${memoryPath}`,
                cause,
              }),
          ),
        );
        const updated = ensureProjectRouteInMemory(
          contents,
          projectLink,
          projectLabelFromLink(projectLink),
          date,
        );

        if (updated === contents) {
          return false;
        }

        yield* fs.writeFileString(memoryPath, updated).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to update vault MEMORY.md: ${memoryPath}`,
                cause,
              }),
          ),
        );
        return true;
      });

      const ensureGitExcludeEntry = Effect.fn("Config.ensureGitExcludeEntry")(function* (
        gitDir: string,
      ): Effect.fn.Return<boolean, ConfigServiceError> {
        const excludePath = path.join(gitDir, "info", "exclude");
        const existing = yield* fs
          .readFileString(excludePath)
          .pipe(Effect.catchTag("PlatformError", () => Effect.succeed("")));

        if (existing.split("\n").some((line) => line.trim() === GIT_EXCLUDE_ENTRY)) {
          return false;
        }

        const next =
          existing.trimEnd().length === 0
            ? `${GIT_EXCLUDE_ENTRY}\n`
            : `${existing.trimEnd()}\n${GIT_EXCLUDE_ENTRY}\n`;

        yield* fs.makeDirectory(path.dirname(excludePath), { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to create git info directory: ${path.dirname(excludePath)}`,
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(excludePath, next).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigServiceError({
                message: `Failed to update git exclude file: ${excludePath}`,
                cause,
              }),
          ),
        );

        return true;
      });

      return Config.of({
        environmentOverrides,
        localPaths,
        load,
        validateInputs,
        projectFilePath,
        projectExists,
        ensureLocalFiles,
        ensureProjectFile,
        ensureMemoryRoute,
        ensureGitExcludeEntry,
      });
    }),
  );
}
