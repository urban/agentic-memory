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
import { CONFIG_FILENAME, LINK_DIRECTORY } from "../constants.ts";
import {
  decodeProjectConfigJson,
  encodeProjectConfigJson,
  LoadConfigResult,
  LocalPaths,
  type ResolvedProjectConfig,
} from "../schema.ts";
import { VaultProjects } from "./VaultProjects.ts";

export type { LoadConfigResult, LocalPaths } from "../schema.ts";

export class CaptureConfigServiceError extends Schema.TaggedErrorClass<CaptureConfigServiceError>()(
  "CaptureConfigServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface EnvironmentOverrides {
  readonly vaultOverride: string | undefined;
  readonly cliBinary: string | undefined;
}

const hasErrnoCode = (cause: unknown, code: string): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

const optionalEnvironmentVariable = Effect.fn("CaptureConfig.optionalEnvironmentVariable")(
  function* (name: string) {
    const value = yield* EffectConfig.string(name).pipe(EffectConfig.option);
    return Option.getOrUndefined(value);
  },
  Effect.catch(() => Effect.sync((): string | undefined => undefined)),
);

export class CaptureConfig extends Context.Service<
  CaptureConfig,
  {
    readonly environmentOverrides: Effect.Effect<EnvironmentOverrides>;
    readonly localPaths: (cwd: string) => Effect.Effect<LocalPaths>;
    readonly load: (cwd: string) => Effect.Effect<LoadConfigResult>;
    readonly ensureLocalFiles: (
      cwd: string,
      config: ResolvedProjectConfig,
    ) => Effect.Effect<LocalPaths, CaptureConfigServiceError>;
  }
>()("@urban/pi-memory-capture/services/CaptureConfig") {
  static readonly layer = Layer.effect(
    CaptureConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const vaultProjects = yield* VaultProjects;

      const environmentOverrides: Effect.Effect<EnvironmentOverrides> = Effect.all({
        vaultOverride: optionalEnvironmentVariable("AGENTIC_MEMORY_VAULT"),
        cliBinary: optionalEnvironmentVariable("AGENTIC_MEMORY_CLI_BIN"),
      }).pipe(Effect.withSpan("CaptureConfig.environmentOverrides"));

      const localPaths = Effect.fn("CaptureConfig.localPaths")((cwd: string) =>
        Effect.succeed(
          LocalPaths.make({
            directory: path.join(cwd, LINK_DIRECTORY),
            configFile: path.join(cwd, LINK_DIRECTORY, CONFIG_FILENAME),
          }),
        ),
      );

      const ensureNotSymlink = Effect.fnUntraced(function* (
        pathValue: string,
        label: string,
      ): Effect.fn.Return<void, CaptureConfigServiceError> {
        const exists = yield* fs.exists(pathValue).pipe(Effect.catch(() => Effect.succeed(false)));
        if (!exists) {
          return;
        }

        yield* fs.readLink(pathValue).pipe(
          Effect.matchEffect({
            onFailure: (cause) =>
              hasErrnoCode(cause.cause, "EINVAL")
                ? Effect.void
                : Effect.fail(
                    new CaptureConfigServiceError({
                      message: `Failed to inspect ${label}: ${pathValue}`,
                      cause,
                    }),
                  ),
            onSuccess: () =>
              Effect.fail(
                new CaptureConfigServiceError({
                  message: `${label} must not be a symlink: ${pathValue}`,
                }),
              ),
          }),
        );
      });

      const ensureLocalPathsSafe = Effect.fnUntraced(function* (
        paths: LocalPaths,
      ): Effect.fn.Return<void, CaptureConfigServiceError> {
        yield* ensureNotSymlink(paths.directory, "Local link directory");
        yield* ensureNotSymlink(paths.configFile, "Local config file");
      });

      const load = Effect.fn("CaptureConfig.load")(function* (
        cwd: string,
      ): Effect.fn.Return<LoadConfigResult> {
        const paths = yield* localPaths(cwd);
        const pathSafety = yield* ensureLocalPathsSafe(paths).pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        );

        if (pathSafety !== undefined) {
          return LoadConfigResult.cases.invalid.make({
            paths,
            message: pathSafety.message,
          });
        }

        const exists = yield* fs
          .exists(paths.configFile)
          .pipe(Effect.catch(() => Effect.succeed(false)));

        if (!exists) {
          return LoadConfigResult.cases.missing.make({ paths });
        }

        const readResult = yield* fs.readFileString(paths.configFile).pipe(
          Effect.match({
            onFailure: (cause) =>
              ({
                _tag: "invalid",
                message: `Failed to read config file: ${paths.configFile}: ${String(cause)}`,
              }) satisfies { readonly _tag: "invalid"; readonly message: string },
            onSuccess: (contents) =>
              ({
                _tag: "contents",
                contents,
              }) satisfies { readonly _tag: "contents"; readonly contents: string },
          }),
        );

        if (readResult._tag === "invalid") {
          return LoadConfigResult.cases.invalid.make({
            paths,
            message: readResult.message,
          });
        }

        const decodedResult = yield* decodeProjectConfigJson(readResult.contents).pipe(
          Effect.match({
            onFailure: (error) =>
              ({
                _tag: "invalid",
                message: `Invalid config JSON: ${error.message}`,
              }) satisfies { readonly _tag: "invalid"; readonly message: string },
            onSuccess: (config) =>
              ({
                _tag: "decoded",
                config,
              }) satisfies { readonly _tag: "decoded"; readonly config: ResolvedProjectConfig },
          }),
        );

        if (decodedResult._tag === "invalid") {
          return LoadConfigResult.cases.invalid.make({
            paths,
            message: decodedResult.message,
          });
        }

        return yield* vaultProjects.validateTarget(decodedResult.config).pipe(
          Effect.match({
            onFailure: (error) =>
              LoadConfigResult.cases.invalid.make({
                paths,
                message: error.message,
              }),
            onSuccess: (config) => LoadConfigResult.cases.valid.make({ paths, config }),
          }),
        );
      });

      const ensureLocalFiles = Effect.fn("CaptureConfig.ensureLocalFiles")(function* (
        cwd: string,
        config: ResolvedProjectConfig,
      ): Effect.fn.Return<LocalPaths, CaptureConfigServiceError> {
        const paths = yield* localPaths(cwd);
        yield* ensureLocalPathsSafe(paths);
        yield* fs.makeDirectory(paths.directory, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new CaptureConfigServiceError({
                message: `Failed to create local link directory: ${paths.directory}`,
                cause,
              }),
          ),
        );
        yield* ensureLocalPathsSafe(paths);

        const configContents = yield* encodeProjectConfigJson(config).pipe(
          Effect.mapError(
            (cause) =>
              new CaptureConfigServiceError({
                message: "Failed to encode local config",
                cause,
              }),
          ),
        );

        yield* fs.writeFileString(paths.configFile, `${configContents}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new CaptureConfigServiceError({
                message: `Failed to write config file: ${paths.configFile}`,
                cause,
              }),
          ),
        );

        return paths;
      });

      return CaptureConfig.of({
        environmentOverrides,
        localPaths,
        load,
        ensureLocalFiles,
      });
    }),
  );
}
