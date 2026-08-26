import {
  LinkConfig,
  LinkConfigError,
  loadLinkConfig,
  localLinkPaths,
  LocalLinkPaths,
  writeLinkConfig,
} from "@urban/agentic-memory-core/link/LinkConfig";
import { validateVaultForLink } from "@urban/agentic-memory-core/vault/VaultStatus";
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

export const CaptureConfigState = Schema.TaggedUnion({
  missing: { paths: LocalLinkPaths },
  invalid: { paths: LocalLinkPaths, message: Schema.String },
  valid: { paths: LocalLinkPaths, config: LinkConfig },
}).annotate({ identifier: "CaptureConfigState" });
export type CaptureConfigState = typeof CaptureConfigState.Type;

type ResolvedProjectConfig = LinkConfig;
type LocalPaths = LocalLinkPaths;

export class CaptureConfigServiceError extends Schema.TaggedError<CaptureConfigServiceError>()(
  "CaptureConfigServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type EnvironmentOverrides = {
  readonly vaultOverride: string | undefined;
  readonly cliBinary: string | undefined;
};

const CORE_INVALID_CONFIG_PREFIX = "Invalid .agentic-memory-link/config.json:";

const translateLoadErrorMessage = (message: string): string =>
  message.startsWith(CORE_INVALID_CONFIG_PREFIX)
    ? `Invalid config JSON:${message.slice(CORE_INVALID_CONFIG_PREFIX.length)}`
    : message;

const translateWriteError = (error: LinkConfigError): CaptureConfigServiceError =>
  CaptureConfigServiceError.make({
    message: error.message,
    cause: error,
  });

const optionalEnvironmentVariable = Effect.fn("CaptureConfig.optionalEnvironmentVariable")(
  function* (name: string) {
    const value = yield* EffectConfig.string(name).pipe(EffectConfig.option);
    return Option.getOrUndefined(value);
  },
  Effect.orElseSucceed((): string | undefined => undefined),
);

export class CaptureConfig extends Context.Service<
  CaptureConfig,
  {
    readonly environmentOverrides: Effect.Effect<EnvironmentOverrides>;
    readonly localPaths: (cwd: string) => Effect.Effect<LocalPaths>;
    readonly load: (cwd: string) => Effect.Effect<CaptureConfigState>;
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

      const environmentOverrides: Effect.Effect<EnvironmentOverrides> = Effect.all({
        vaultOverride: optionalEnvironmentVariable("AGENTIC_MEMORY_VAULT"),
        cliBinary: optionalEnvironmentVariable("AGENTIC_MEMORY_CLI_BIN"),
      }).pipe(Effect.withSpan("CaptureConfig.environmentOverrides"));

      const localPaths = Effect.fn("CaptureConfig.localPaths")((cwd: string) =>
        localLinkPaths(cwd).pipe(Effect.provideService(Path.Path, path)),
      );

      const load = Effect.fn("CaptureConfig.load")(function* (
        cwd: string,
      ): Effect.fn.Return<CaptureConfigState> {
        const loaded = yield* loadLinkConfig(cwd).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );

        if (loaded._tag === "missing") {
          return CaptureConfigState.cases.missing.make({ paths: loaded.paths });
        }

        if (loaded._tag === "invalid") {
          return CaptureConfigState.cases.invalid.make({
            paths: loaded.paths,
            message: translateLoadErrorMessage(loaded.message),
          });
        }

        return yield* validateVaultForLink(loaded.config.vaultPath).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.match({
            onFailure: (error) =>
              CaptureConfigState.cases.invalid.make({
                paths: loaded.paths,
                message: error.message,
              }),
            onSuccess: () =>
              CaptureConfigState.cases.valid.make({
                paths: loaded.paths,
                config: loaded.config,
              }),
          }),
        );
      });

      const ensureLocalFiles = Effect.fn("CaptureConfig.ensureLocalFiles")(function* (
        cwd: string,
        config: ResolvedProjectConfig,
      ): Effect.fn.Return<LocalPaths, CaptureConfigServiceError> {
        return yield* writeLinkConfig(cwd, config).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(translateWriteError),
        );
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
