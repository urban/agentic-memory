import { createHash } from "node:crypto";
import { homedir } from "node:os";
import {
  Config,
  Console,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { getLlama, LlamaLogLevel, resolveModelFile } from "node-llama-cpp";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_FILE_NAME,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_SHA256,
  EMBEDDING_MODEL_URI,
  EmbeddingModel,
  EmbeddingModelDownloadError,
  EmbeddingModelMissingError,
  EmbeddingRuntimeError,
  InvalidEmbeddingArtifactError,
  makeEmbeddingModel,
} from "./EmbeddingModel.ts";

export interface EmbeddingModelFileResolverOptions {
  readonly directory: string;
  readonly fileName: string;
  readonly cli: false;
  readonly deleteTempFileOnCancel: true;
  readonly onProgress: (progress: {
    readonly downloadedSize: number;
    readonly totalSize: number;
  }) => void;
}

export interface EmbeddingRuntimeContext {
  readonly getEmbeddingFor: (text: string) => Promise<{ readonly vector: ReadonlyArray<number> }>;
  readonly dispose: () => Promise<void>;
}

export interface EmbeddingRuntimeModel {
  readonly embeddingVectorSize: number;
  readonly createEmbeddingContext: (options: {
    readonly contextSize: number;
  }) => Promise<EmbeddingRuntimeContext>;
  readonly dispose: () => Promise<void>;
}

export interface EmbeddingRuntime {
  readonly loadModel: (options: { readonly modelPath: string }) => Promise<EmbeddingRuntimeModel>;
  readonly dispose: () => Promise<void>;
  readonly buildType?: string;
  readonly gpu?: string | false;
  readonly llamaCppRelease?: {
    readonly repo: string;
    readonly release: string;
  };
}

export interface EmbeddingModelLiveOptions {
  readonly resolveModelFile: (
    uri: string,
    options: EmbeddingModelFileResolverOptions,
  ) => Effect.Effect<string, EmbeddingModelDownloadError>;
  readonly initializeRuntime?: () => Promise<EmbeddingRuntime>;
  readonly homeDirectory?: string;
  readonly artifactSha256?: string;
}

type SessionAcquisitionError =
  | InvalidEmbeddingArtifactError
  | EmbeddingModelDownloadError
  | EmbeddingModelMissingError
  | EmbeddingRuntimeError;

type SessionFailureCause = import("effect").Cause.Cause<SessionAcquisitionError>;
type SessionScope = import("effect").Scope.Closeable;
type FileSize = import("effect").FileSystem.Size;

interface EmbeddingSession {
  readonly context: EmbeddingRuntimeContext;
  readonly scope: SessionScope;
}

interface ValidatedArtifactIdentity {
  readonly device: number;
  readonly inode: number | undefined;
  readonly modifiedAt: number | undefined;
  readonly size: FileSize;
}

type SessionState =
  | { readonly _tag: "Dormant" }
  | { readonly _tag: "Acquiring"; readonly scope: SessionScope }
  | { readonly _tag: "Ready"; readonly session: EmbeddingSession }
  | {
      readonly _tag: "Closed";
      readonly reason:
        | { readonly _tag: "AcquisitionFailed"; readonly cause: SessionFailureCause }
        | { readonly _tag: "LayerFinalized" };
    };

const resolveCacheDirectory = Effect.fnUntraced(function* (homeDirectory: string) {
  const path = yield* Path.Path;
  const configured = yield* Config.string("XDG_CACHE_HOME").pipe(
    Config.option,
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  const configuredPath = Option.getOrUndefined(configured);
  const cacheRoot =
    configuredPath !== undefined && path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(homeDirectory, ".cache");
  return path.join(cacheRoot, "agentic-memory", "models");
});

const modelOperation = <A>(message: string, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new EmbeddingRuntimeError({ message, cause }),
  }).pipe(Effect.uninterruptible);

const nativeModelFileResolver: EmbeddingModelLiveOptions["resolveModelFile"] = (uri, options) =>
  Effect.callback<string, EmbeddingModelDownloadError>((resume, signal) => {
    const resolution = Promise.resolve().then(() =>
      resolveModelFile(uri, {
        ...options,
        signal,
      }),
    );
    resolution.then(
      (resolvedPath) => resume(Effect.succeed(resolvedPath)),
      (cause) =>
        resume(
          Effect.fail(
            new EmbeddingModelDownloadError({
              message: `Failed to download ${EMBEDDING_MODEL_ID}`,
              cause,
            }),
          ),
        ),
    );
    return Effect.promise(() =>
      resolution.then(
        () => undefined,
        () => undefined,
      ),
    );
  });

const make = (options: Required<EmbeddingModelLiveOptions>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = yield* Console.Console;
    const lifecycleProbeEnabled = yield* Config.string("AGENTIC_MEMORY_SEMANTIC_PROBE").pipe(
      Config.option,
      Effect.orElseSucceed(() => Option.none<string>()),
      Effect.map((value) => Option.contains(value, "1")),
    );
    const reportLifecycle = (event: string): Effect.Effect<void> =>
      lifecycleProbeEnabled
        ? Effect.sync(() => output.error(`[agentic-memory:semantic-probe] ${event}`))
        : Effect.void;
    const modelDirectory = yield* resolveCacheDirectory(options.homeDirectory);
    const artifactPath = path.join(modelDirectory, EMBEDDING_MODEL_FILE_NAME);
    const validatedArtifact = yield* Ref.make<ValidatedArtifactIdentity | undefined>(undefined);

    const artifactIdentity = Effect.fnUntraced(function* () {
      const info = yield* fs.stat(artifactPath).pipe(
        Effect.mapError(
          (cause) =>
            new InvalidEmbeddingArtifactError({
              message: "Failed to inspect the embedding model artifact",
              cause,
            }),
        ),
      );
      return {
        device: info.dev,
        inode: Option.getOrUndefined(info.ino),
        modifiedAt: Option.getOrUndefined(info.mtime)?.getTime(),
        size: info.size,
      } satisfies ValidatedArtifactIdentity;
    });

    const artifactIdentityMatches = (
      left: ValidatedArtifactIdentity,
      right: ValidatedArtifactIdentity,
    ): boolean =>
      left.device === right.device &&
      left.inode === right.inode &&
      left.modifiedAt === right.modifiedAt &&
      left.size === right.size;

    const validateArtifact = Effect.fnUntraced(function* (candidatePath: string) {
      const digest = createHash("sha256");
      const magicBytes = new Uint8Array(4);
      let magicLength = 0;

      yield* fs.stream(candidatePath).pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            digest.update(chunk);
            const copiedBytes = Math.min(4 - magicLength, chunk.length);
            magicBytes.set(chunk.subarray(0, copiedBytes), magicLength);
            magicLength += copiedBytes;
          }),
        ),
        Effect.mapError(
          (cause) =>
            new InvalidEmbeddingArtifactError({
              message: "Failed to inspect the embedding model artifact",
              cause,
            }),
        ),
      );

      const magic = String.fromCharCode(...magicBytes);
      if (magic !== "GGUF") {
        return yield* new InvalidEmbeddingArtifactError({
          message: `Embedding model artifact has invalid GGUF magic: ${magic}`,
        });
      }
      const sha256 = digest.digest("hex");
      if (sha256 !== options.artifactSha256) {
        return yield* new InvalidEmbeddingArtifactError({
          message: `Embedding model artifact checksum does not match ${options.artifactSha256}`,
        });
      }
    });

    const validateCanonicalArtifact = Effect.fnUntraced(function* () {
      const identityBeforeValidation = yield* artifactIdentity();
      yield* validateArtifact(artifactPath);
      const identityAfterValidation = yield* artifactIdentity();
      if (!artifactIdentityMatches(identityBeforeValidation, identityAfterValidation)) {
        return yield* new InvalidEmbeddingArtifactError({
          message: "Embedding model artifact changed during validation",
        });
      }
      yield* Ref.set(validatedArtifact, identityAfterValidation);
    });

    const inspect = Effect.fnUntraced(function* () {
      yield* Ref.set(validatedArtifact, undefined);
      const exists = yield* fs.exists(artifactPath).pipe(
        Effect.mapError(
          (cause) =>
            new EmbeddingModelDownloadError({
              message: "Failed to inspect the shared embedding model cache",
              cause,
            }),
        ),
      );
      if (!exists) {
        const missing: import("./EmbeddingModel.ts").EmbeddingModelInspection = {
          status: "missing",
          id: EMBEDDING_MODEL_ID,
        };
        return missing;
      }
      yield* validateCanonicalArtifact();
      const available: import("./EmbeddingModel.ts").EmbeddingModelInspection = {
        status: "available",
        id: EMBEDDING_MODEL_ID,
      };
      return available;
    });

    const install = Effect.fnUntraced(function* () {
      const current = yield* inspect();
      if (current.status === "available") {
        const alreadyAvailable: import("./EmbeddingModel.ts").EmbeddingModelInstallResult = {
          status: "already_available",
          id: EMBEDDING_MODEL_ID,
        };
        return alreadyAvailable;
      }

      yield* fs.makeDirectory(modelDirectory, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new EmbeddingModelDownloadError({
              message: "Failed to create the shared embedding model cache",
              cause,
            }),
        ),
      );

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const stagingDirectory = yield* fs
            .makeTempDirectoryScoped({
              directory: modelDirectory,
              prefix: ".embeddinggemma-download-",
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new EmbeddingModelDownloadError({
                    message: "Failed to create model download staging storage",
                    cause,
                  }),
              ),
            );
          let lastReportedPercent = -10;
          const stagedPath = yield* options.resolveModelFile(EMBEDDING_MODEL_URI, {
            directory: stagingDirectory,
            fileName: EMBEDDING_MODEL_FILE_NAME,
            cli: false,
            deleteTempFileOnCancel: true,
            onProgress: ({ downloadedSize, totalSize }) => {
              const percent = totalSize === 0 ? 0 : Math.floor((downloadedSize / totalSize) * 100);
              if (percent >= lastReportedPercent + 10 || percent === 100) {
                lastReportedPercent = percent;
                output.error(`Embedding model download: ${percent}%`);
              }
            },
          });
          yield* validateArtifact(stagedPath);
          yield* fs.rename(stagedPath, artifactPath).pipe(
            Effect.mapError(
              (cause) =>
                new EmbeddingModelDownloadError({
                  message: "Failed to publish the validated embedding model artifact",
                  cause,
                }),
            ),
          );
          yield* Ref.set(validatedArtifact, yield* artifactIdentity());
          const downloaded: import("./EmbeddingModel.ts").EmbeddingModelInstallResult = {
            status: "downloaded",
            id: EMBEDDING_MODEL_ID,
          };
          return downloaded;
        }),
      );
    });

    const acquireSession = Effect.fnUntraced(function* (scope: SessionScope) {
      const cachedIdentity = yield* Ref.get(validatedArtifact);
      const currentIdentity =
        cachedIdentity === undefined
          ? Option.none<ValidatedArtifactIdentity>()
          : yield* artifactIdentity().pipe(Effect.option);
      if (
        cachedIdentity === undefined ||
        !Option.exists(currentIdentity, (identity) =>
          artifactIdentityMatches(cachedIdentity, identity),
        )
      ) {
        const inspection = yield* inspect();
        if (inspection.status === "missing") {
          return yield* new EmbeddingModelMissingError({
            message: `Embedding model ${EMBEDDING_MODEL_ID} is not installed`,
          });
        }
      }

      const llama = yield* Effect.acquireRelease(
        modelOperation(
          "Failed to initialize the embedding runtime",
          options.initializeRuntime,
        ).pipe(
          Effect.tap((runtime) =>
            reportLifecycle(
              [
                "runtime_acquired",
                `buildType=${runtime.buildType ?? "unreported"}`,
                `gpu=${runtime.gpu ?? "unreported"}`,
                `llamaCppRepo=${runtime.llamaCppRelease?.repo ?? "unreported"}`,
                `llamaCppRelease=${runtime.llamaCppRelease?.release ?? "unreported"}`,
              ].join(" "),
            ),
          ),
        ),
        (resource) =>
          Effect.promise(() => resource.dispose()).pipe(
            Effect.tap(() => reportLifecycle("runtime_disposed")),
          ),
      ).pipe(Scope.provide(scope));
      const model = yield* Effect.acquireRelease(
        modelOperation("Failed to load the embedding model", () =>
          llama.loadModel({ modelPath: artifactPath }),
        ).pipe(Effect.tap(() => reportLifecycle("model_acquired"))),
        (resource) =>
          Effect.promise(() => resource.dispose()).pipe(
            Effect.tap(() => reportLifecycle("model_disposed")),
          ),
      ).pipe(Scope.provide(scope));
      if (model.embeddingVectorSize !== EMBEDDING_MODEL_DIMENSIONS) {
        return yield* new EmbeddingRuntimeError({
          message: `Embedding model dimension ${model.embeddingVectorSize} does not match ${EMBEDDING_MODEL_DIMENSIONS}`,
        });
      }
      const context = yield* Effect.acquireRelease(
        modelOperation("Failed to create the embedding context", () =>
          model.createEmbeddingContext({ contextSize: 2048 }),
        ).pipe(Effect.tap(() => reportLifecycle("context_acquired"))),
        (resource) =>
          Effect.promise(() => resource.dispose()).pipe(
            Effect.tap(() => reportLifecycle("context_disposed")),
          ),
      ).pipe(Scope.provide(scope));
      return { context, scope };
    });

    const sessionState = yield* Ref.make<SessionState>({ _tag: "Dormant" });
    const sessionPermit = yield* Semaphore.make(1);

    const getSession = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(sessionState);
        switch (state._tag) {
          case "Ready":
            return state.session;
          case "Closed":
            return state.reason._tag === "AcquisitionFailed"
              ? yield* Effect.failCause(state.reason.cause)
              : yield* new EmbeddingRuntimeError({
                  message: "Embedding session is closed",
                });
          case "Acquiring":
            return yield* new EmbeddingRuntimeError({
              message: "Embedding session acquisition is already in progress",
            });
          case "Dormant": {
            const scope = yield* Scope.make("sequential");
            yield* Ref.set(sessionState, { _tag: "Acquiring", scope });
            const acquisition = yield* restore(acquireSession(scope)).pipe(Effect.exit);
            if (Exit.isSuccess(acquisition)) {
              yield* Ref.set(sessionState, { _tag: "Ready", session: acquisition.value });
              return acquisition.value;
            }
            yield* Scope.close(scope, acquisition);
            yield* Ref.set(sessionState, {
              _tag: "Closed",
              reason: { _tag: "AcquisitionFailed", cause: acquisition.cause },
            });
            return yield* Effect.failCause(acquisition.cause);
          }
        }
      }),
    );

    yield* Effect.addFinalizer((exit) =>
      sessionPermit.withPermit(
        Effect.gen(function* () {
          const state = yield* Ref.get(sessionState);
          switch (state._tag) {
            case "Dormant":
              yield* Ref.set(sessionState, {
                _tag: "Closed",
                reason: { _tag: "LayerFinalized" },
              });
              return;
            case "Acquiring":
              yield* Scope.close(state.scope, exit);
              yield* Ref.set(sessionState, {
                _tag: "Closed",
                reason: { _tag: "LayerFinalized" },
              });
              return;
            case "Ready":
              yield* Scope.close(state.session.scope, exit);
              yield* Ref.set(sessionState, {
                _tag: "Closed",
                reason: { _tag: "LayerFinalized" },
              });
              return;
            case "Closed":
              return;
          }
        }),
      ),
    );

    const embed = Effect.fnUntraced(function* (texts: ReadonlyArray<string>) {
      if (texts.length === 0) {
        return [];
      }
      const embeddings = yield* Effect.forEach(texts, (text) =>
        sessionPermit.withPermit(
          Effect.gen(function* () {
            const session = yield* getSession;
            return yield* modelOperation("Failed to generate an embedding", () =>
              session.context.getEmbeddingFor(text),
            );
          }),
        ),
      );
      return embeddings.map((embedding) => embedding.vector);
    });

    return makeEmbeddingModel({ inspect: inspect(), install: install(), embed });
  });

export const makeEmbeddingModelLive = (
  options: EmbeddingModelLiveOptions,
): Layer.Layer<EmbeddingModel, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    EmbeddingModel,
    make({
      resolveModelFile: options.resolveModelFile,
      initializeRuntime:
        options.initializeRuntime ?? (() => getLlama({ logLevel: LlamaLogLevel.error })),
      homeDirectory: options.homeDirectory ?? homedir(),
      artifactSha256: options.artifactSha256 ?? EMBEDDING_MODEL_SHA256,
    }),
  );

export const EmbeddingModelLive = makeEmbeddingModelLive({
  resolveModelFile: nativeModelFileResolver,
});
