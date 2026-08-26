import { createHash } from "node:crypto";
import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Path,
} from "effect";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EmbeddingBatchError,
  EmbeddingModel,
  EmbeddingModelDownloadError,
  EmbeddingRuntimeError,
  EmptyEmbeddingTextError,
  InvalidEmbeddingArtifactError,
  makeEmbeddingModel,
  makeFakeEmbeddingModelLayer,
  MAX_EMBEDDING_BATCH_SIZE,
} from "../src/semantic/EmbeddingModel.ts";
import { makeEmbeddingModelLive } from "../src/semantic/EmbeddingModelLive.ts";
import { initVaultFromTemplate } from "../src/vault/VaultTemplate.ts";
import { VaultRepository, VaultRepositoryLive } from "../src/vault/VaultRepository.ts";

type EmbeddingModelLiveOptions =
  import("../src/semantic/EmbeddingModelLive.ts").EmbeddingModelLiveOptions;
type EmbeddingRuntime = import("../src/semantic/EmbeddingModelLive.ts").EmbeddingRuntime;
type ModelFileResolver = EmbeddingModelLiveOptions["resolveModelFile"];
type FileSystemService = import("effect").FileSystem.FileSystem;
type PathService = import("effect").Path.Path;

type ModelProvisioningRequirements =
  | EmbeddingModel
  | import("effect").FileSystem.FileSystem
  | import("effect").Path.Path
  | import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner;
type VaultInitializationRequirements = ModelProvisioningRequirements | VaultRepository;
type BunRequirements = Exclude<ModelProvisioningRequirements, EmbeddingModel>;

const withModel = <A, E, R>(
  effect: Effect.Effect<A, E, R | VaultInitializationRequirements>,
  modelLayer: Layer.Layer<EmbeddingModel>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      BunServices.layer,
      modelLayer,
      VaultRepositoryLive.pipe(Layer.provide(BunServices.layer)),
    ),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const withBunServices = <A, E, R>(effect: Effect.Effect<A, E, R | BunRequirements>) => {
  const runtime = ManagedRuntime.make(BunServices.layer);
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const validArtifact = new TextEncoder().encode("GGUF deterministic test artifact");
const validArtifactSha256 = createHash("sha256").update(validArtifact).digest("hex");

const modelDirectory = (path: PathService, cacheRoot: string) =>
  path.join(cacheRoot, "agentic-memory", "models");
const canonicalArtifact = (path: PathService, cacheRoot: string) =>
  path.join(modelDirectory(path, cacheRoot), "embeddinggemma-300M-Q8_0.gguf");

const stagedEntries = (cacheRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(modelDirectory(path, cacheRoot));
    return entries.filter((entry) => entry.startsWith(".embeddinggemma-download-"));
  });

const makeArtifactResolver = (
  fs: FileSystemService,
  path: PathService,
  artifact: Uint8Array,
): ModelFileResolver =>
  Effect.fnUntraced(function* (_uri, options) {
    const stagedPath = path.join(options.directory, options.fileName);
    yield* fs.writeFile(stagedPath, artifact).pipe(
      Effect.mapError((cause) =>
        EmbeddingModelDownloadError.make({
          message: "Failed to write the fake model download",
          cause,
        }),
      ),
    );
    return stagedPath;
  });

const provideLiveModel = <A, E, R>(
  effect: Effect.Effect<A, E, R | VaultInitializationRequirements>,
  options: EmbeddingModelLiveOptions,
  env: Readonly<Record<string, string>>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.merge(
      makeEmbeddingModelLive(options).pipe(
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        Layer.provideMerge(BunServices.layer),
      ),
      VaultRepositoryLive.pipe(Layer.provide(BunServices.layer)),
    ),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const provideLiveModelWithFileSystem = <A, E, R>(
  effect: Effect.Effect<A, E, R | EmbeddingModel | Path.Path>,
  options: EmbeddingModelLiveOptions,
  env: Readonly<Record<string, string>>,
  fileSystem: FileSystemService,
) => {
  const runtime = ManagedRuntime.make(
    makeEmbeddingModelLive(options).pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
      Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
      Layer.provideMerge(BunServices.layer),
    ),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

describe("embedding model provisioning", () => {
  it.effect("rejects empty text through the fake and shared adapter boundary", () => {
    const adapterBoundaryModel = makeEmbeddingModel({
      inspect: Effect.succeed({
        status: "available",
        id: EMBEDDING_MODEL_ID,
      }),
      install: Effect.succeed({
        status: "already_available",
        id: EMBEDDING_MODEL_ID,
      }),
      embed: () =>
        Effect.fail(
          EmbeddingRuntimeError.make({
            message: "Adapter-specific embedding must not run for empty text",
          }),
        ),
    });
    const modelLayers = [
      makeFakeEmbeddingModelLayer(),
      Layer.succeed(EmbeddingModel, adapterBoundaryModel),
    ];

    return Effect.forEach(modelLayers, (modelLayer) =>
      withModel(
        Effect.gen(function* () {
          const model = yield* EmbeddingModel;
          const failure = yield* model.embed([""]).pipe(Effect.flip);

          assert.instanceOf(failure, EmptyEmbeddingTextError);
          assert.strictEqual(failure.message, "Embedding text must not be empty");
        }),
        modelLayer,
      ),
    );
  });

  it.effect("resolves an absolute XDG cache and publishes only after a staged download", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-publication-",
          });
          const cacheRoot = path.join(tempRoot, "xdg-cache");
          const homeDirectory = path.join(tempRoot, "home");
          let stagedArtifactExisted = false;
          let canonicalArtifactExisted = true;
          let resolvedUri = "";
          const resolver: ModelFileResolver = (uri, options) =>
            Effect.gen(function* () {
              resolvedUri = uri;
              const stagedPath = path.join(options.directory, options.fileName);
              yield* fs.writeFile(stagedPath, validArtifact).pipe(
                Effect.mapError((cause) =>
                  EmbeddingModelDownloadError.make({
                    message: "Failed to write the fake model download",
                    cause,
                  }),
                ),
              );
              stagedArtifactExisted = yield* fs.exists(stagedPath).pipe(
                Effect.mapError((cause) =>
                  EmbeddingModelDownloadError.make({
                    message: "Failed to inspect the fake staged artifact",
                    cause,
                  }),
                ),
              );
              canonicalArtifactExisted = yield* fs.exists(canonicalArtifact(path, cacheRoot)).pipe(
                Effect.mapError((cause) =>
                  EmbeddingModelDownloadError.make({
                    message: "Failed to inspect the fake canonical artifact",
                    cause,
                  }),
                ),
              );
              return stagedPath;
            });

          const result = yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              return yield* model.install;
            }),
            {
              resolveModelFile: resolver,
              homeDirectory,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
          );
          const publishedArtifact = yield* fs.readFile(canonicalArtifact(path, cacheRoot));

          assert.strictEqual(result.status, "downloaded");
          assert.strictEqual(
            resolvedUri,
            "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
          );
          assert.isTrue(stagedArtifactExisted);
          assert.isFalse(canonicalArtifactExisted);
          assert.deepEqual(Array.from(publishedArtifact), Array.from(validArtifact));
          assert.deepEqual(yield* stagedEntries(cacheRoot), []);
          assert.isFalse(
            yield* fs.exists(canonicalArtifact(path, path.join(homeDirectory, ".cache"))),
          );
        }),
      ),
    ),
  );

  it.effect("falls back to the injected home cache for a relative XDG cache", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-xdg-fallback-",
          });
          const homeDirectory = path.join(tempRoot, "home");
          const fallbackCacheRoot = path.join(homeDirectory, ".cache");

          yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              yield* model.install;
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              homeDirectory,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: "relative-cache" },
          );

          assert.isTrue(yield* fs.exists(canonicalArtifact(path, fallbackCacheRoot)));
          assert.isFalse(
            yield* fs.exists(canonicalArtifact(path, path.join(tempRoot, "relative-cache"))),
          );
        }),
      ),
    ),
  );

  it.effect("rejects invalid GGUF artifacts without publishing or retaining staging files", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-validation-",
          });
          const invalidCases = [
            {
              name: "magic",
              artifact: new TextEncoder().encode("NOPE invalid magic"),
              message: "invalid GGUF magic",
            },
            {
              name: "checksum",
              artifact: new TextEncoder().encode("GGUF wrong checksum"),
              message: "checksum does not match",
            },
          ];

          yield* Effect.forEach(invalidCases, (invalidCase) => {
            const cacheRoot = path.join(tempRoot, invalidCase.name);
            return Effect.gen(function* () {
              const failure = yield* provideLiveModel(
                Effect.gen(function* () {
                  const model = yield* EmbeddingModel;
                  return yield* model.install;
                }),
                {
                  resolveModelFile: makeArtifactResolver(fs, path, invalidCase.artifact),
                  artifactSha256: validArtifactSha256,
                },
                { XDG_CACHE_HOME: cacheRoot },
              ).pipe(Effect.flip);

              assert.instanceOf(failure, InvalidEmbeddingArtifactError);
              assert.include(failure.message, invalidCase.message);
              assert.isFalse(yield* fs.exists(canonicalArtifact(path, cacheRoot)));
              assert.deepEqual(yield* stagedEntries(cacheRoot), []);
            });
          });
        }),
      ),
    ),
  );

  it.effect("cleans partial staging storage after a download failure", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-download-failure-",
          });
          const cacheRoot = path.join(tempRoot, "cache");
          const resolver: ModelFileResolver = (_uri, options) =>
            fs.writeFileString(path.join(options.directory, "partial.download"), "partial").pipe(
              Effect.mapError((cause) =>
                EmbeddingModelDownloadError.make({
                  message: "Failed to write the partial fake download",
                  cause,
                }),
              ),
              Effect.andThen(
                Effect.fail(
                  EmbeddingModelDownloadError.make({
                    message: "Failed to download the fake model",
                  }),
                ),
              ),
            );

          const failure = yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              return yield* model.install;
            }),
            { resolveModelFile: resolver },
            { XDG_CACHE_HOME: cacheRoot },
          ).pipe(Effect.flip);

          assert.instanceOf(failure, EmbeddingModelDownloadError);
          assert.include(failure.message, "Failed to download");
          assert.isFalse(yield* fs.exists(canonicalArtifact(path, cacheRoot)));
          assert.deepEqual(yield* stagedEntries(cacheRoot), []);
        }),
      ),
    ),
  );

  it.effect("cancels an interrupted download before removing its staging directory", () => {
    const resolverStarted = Promise.withResolvers<void>();
    const cancellationStarted = Promise.withResolvers<void>();
    const releaseCancellation = Promise.withResolvers<void>();
    let suppliedSignal: AbortSignal | undefined;
    let stagingDirectory: string | undefined;
    let cacheRoot: string | undefined;
    let cancellationCompleted = false;

    const resolver: ModelFileResolver = (_uri, options) =>
      Effect.callback<string, EmbeddingModelDownloadError>((resume, signal) => {
        const cancellationSettled = Promise.withResolvers<void>();
        suppliedSignal = signal;
        stagingDirectory = options.directory;
        signal.addEventListener(
          "abort",
          () => {
            cancellationStarted.resolve();
            void releaseCancellation.promise.then(() => {
              cancellationCompleted = true;
              cancellationSettled.resolve();
              resume(
                Effect.fail(
                  EmbeddingModelDownloadError.make({
                    message: "Fake model download was interrupted",
                    cause: signal.reason,
                  }),
                ),
              );
            });
          },
          { once: true },
        );
        resolverStarted.resolve();
        return Effect.promise(() => cancellationSettled.promise);
      });
    const testLayer = Layer.unwrap(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempRoot = yield* fs.makeTempDirectoryScoped({
          prefix: "agentic-memory-model-cancellation-",
        });
        cacheRoot = tempRoot;
        return makeEmbeddingModelLive({ resolveModelFile: resolver }).pipe(
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { XDG_CACHE_HOME: tempRoot } })),
          ),
        );
      }),
    ).pipe(Layer.provideMerge(BunServices.layer));
    const runtime = ManagedRuntime.make(testLayer);

    const test = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const model = yield* EmbeddingModel;
      const installFiber = yield* model.install.pipe(Effect.forkChild({ startImmediately: true }));

      yield* Effect.promise(() => resolverStarted.promise);
      const stagingExistsBeforeInterrupt =
        stagingDirectory === undefined ? false : yield* fs.exists(stagingDirectory);
      const interruptFiber = yield* Fiber.interrupt(installFiber).pipe(
        Effect.forkChild({ startImmediately: true }),
      );

      yield* Effect.promise(() => cancellationStarted.promise);
      const stagingExistsDuringCancellation =
        stagingDirectory === undefined ? false : yield* fs.exists(stagingDirectory);

      assert.isTrue(suppliedSignal?.aborted === true);
      assert.isFalse(cancellationCompleted);
      assert.isTrue(stagingExistsBeforeInterrupt);
      assert.isTrue(stagingExistsDuringCancellation);

      releaseCancellation.resolve();
      yield* Fiber.join(interruptFiber);

      const stagingExists =
        stagingDirectory === undefined ? true : yield* fs.exists(stagingDirectory);
      const canonicalExists =
        cacheRoot === undefined
          ? true
          : yield* fs.exists(
              path.join(cacheRoot, "agentic-memory", "models", "embeddinggemma-300M-Q8_0.gguf"),
            );

      assert.isTrue(cancellationCompleted);
      assert.isFalse(stagingExists);
      assert.isFalse(canonicalExists);
    });
    return runtime.contextEffect.pipe(
      Effect.flatMap((context) => Effect.provideContext(test, context)),
      Effect.ensuring(runtime.disposeEffect),
    );
  });

  it.effect("keeps inspection, installation, and unused layer shutdown native-lazy", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-native-laziness-",
          });
          const acquired: Array<string> = [];
          const disposed: Array<string> = [];
          const initializeRuntime = (): Promise<EmbeddingRuntime> => {
            acquired.push("runtime");
            return Promise.resolve({
              loadModel: () => {
                acquired.push("model");
                return Promise.reject("model loading must not run");
              },
              dispose: () => {
                disposed.push("runtime");
                return Promise.resolve();
              },
            });
          };

          yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              const beforeInstall = yield* model.inspect;
              assert.strictEqual(beforeInstall.status, "missing");
              const installed = yield* model.install;
              assert.strictEqual(installed.status, "downloaded");
              const afterInstall = yield* model.inspect;
              assert.strictEqual(afterInstall.status, "available");
              assert.deepEqual(acquired, []);
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
          );

          assert.deepEqual(acquired, []);
          assert.deepEqual(disposed, []);
        }),
      ),
    ),
  );

  it.effect("reuses validation when acquiring a session for an unchanged artifact", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-validation-reuse-",
          });
          const artifactPath = canonicalArtifact(path, cacheRoot);
          yield* fs.makeDirectory(modelDirectory(path, cacheRoot), { recursive: true });
          yield* fs.writeFile(artifactPath, validArtifact);
          let artifactStreamCount = 0;
          const countingFileSystem: FileSystemService = {
            ...fs,
            stream: (candidatePath, streamOptions) => {
              if (candidatePath === artifactPath) {
                artifactStreamCount += 1;
              }
              return streamOptions === undefined
                ? fs.stream(candidatePath)
                : fs.stream(candidatePath, streamOptions);
            },
          };
          const initializeRuntime = (): Promise<EmbeddingRuntime> =>
            Promise.resolve({
              loadModel: () =>
                Promise.resolve({
                  embeddingVectorSize: EMBEDDING_MODEL_DIMENSIONS,
                  createEmbeddingContext: () =>
                    Promise.resolve({
                      getEmbeddingFor: () =>
                        Promise.resolve({
                          vector: Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, () => 1),
                        }),
                      dispose: () => Promise.resolve(),
                    }),
                  dispose: () => Promise.resolve(),
                }),
              dispose: () => Promise.resolve(),
            });

          yield* provideLiveModelWithFileSystem(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              assert.strictEqual((yield* model.inspect).status, "available");
              yield* model.embed(["question"]);
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
            countingFileSystem,
          );

          assert.strictEqual(artifactStreamCount, 1);
        }),
      ),
    ),
  );

  it.effect("revalidates an artifact changed before session acquisition", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-validation-change-",
          });
          const artifactPath = canonicalArtifact(path, cacheRoot);
          yield* fs.makeDirectory(modelDirectory(path, cacheRoot), { recursive: true });
          yield* fs.writeFile(artifactPath, validArtifact);
          let artifactStreamCount = 0;
          const countingFileSystem: FileSystemService = {
            ...fs,
            stream: (candidatePath, streamOptions) => {
              if (candidatePath === artifactPath) {
                artifactStreamCount += 1;
              }
              return streamOptions === undefined
                ? fs.stream(candidatePath)
                : fs.stream(candidatePath, streamOptions);
            },
          };

          const failure = yield* provideLiveModelWithFileSystem(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              assert.strictEqual((yield* model.inspect).status, "available");
              yield* fs.writeFileString(artifactPath, "GGUF changed after validation");
              return yield* model.embed(["question"]);
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime: () => Promise.reject("runtime must not be acquired"),
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
            countingFileSystem,
          ).pipe(Effect.flip);

          assert.instanceOf(failure, InvalidEmbeddingArtifactError);
          assert.strictEqual(artifactStreamCount, 2);
        }),
      ),
    ),
  );

  it.effect("lazily reuses one native session until the live layer closes", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-session-reuse-",
          });
          const acquired: Array<string> = [];
          const disposed: Array<string> = [];
          const initializeRuntime = (): Promise<EmbeddingRuntime> => {
            acquired.push("runtime");
            return Promise.resolve({
              loadModel: () => {
                acquired.push("model");
                return Promise.resolve({
                  embeddingVectorSize: EMBEDDING_MODEL_DIMENSIONS,
                  createEmbeddingContext: () => {
                    acquired.push("context");
                    return Promise.resolve({
                      getEmbeddingFor: () =>
                        Promise.resolve({
                          vector: Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, () => 1),
                        }),
                      dispose: () => {
                        disposed.push("context");
                        return Promise.resolve();
                      },
                    });
                  },
                  dispose: () => {
                    disposed.push("model");
                    return Promise.resolve();
                  },
                });
              },
              dispose: () => {
                disposed.push("runtime");
                return Promise.resolve();
              },
            });
          };

          const vectorLengths = yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              const beforeInstall = yield* model.inspect;
              assert.strictEqual(beforeInstall.status, "missing");
              yield* model.install;
              const afterInstall = yield* model.inspect;
              assert.strictEqual(afterInstall.status, "available");
              assert.deepEqual(acquired, []);

              const first = yield* model.embed(["first"]);
              yield* fs.writeFileString(canonicalArtifact(path, cacheRoot), "invalid after load");
              const second = yield* model.embed(["second"]);

              assert.deepEqual(acquired, ["runtime", "model", "context"]);
              assert.deepEqual(disposed, []);
              return [first[0]?.length, second[0]?.length];
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
          );

          assert.deepEqual(vectorLengths, [EMBEDDING_MODEL_DIMENSIONS, EMBEDDING_MODEL_DIMENSIONS]);
          assert.deepEqual(acquired, ["runtime", "model", "context"]);
          assert.deepEqual(disposed, ["context", "model", "runtime"]);
        }),
      ),
    ),
  );

  it.effect("single-flights acquisition and serializes concurrent native evaluations", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-concurrency-",
          });
          const acquired: Array<string> = [];
          const disposed: Array<string> = [];
          const runtimeStarted = Promise.withResolvers<void>();
          const runtimeAcquisition = Promise.withResolvers<EmbeddingRuntime>();
          const firstEmbeddingStarted = Promise.withResolvers<void>();
          const secondEmbeddingStarted = Promise.withResolvers<void>();
          const firstEmbedding = Promise.withResolvers<{
            readonly vector: ReadonlyArray<number>;
          }>();
          const secondEmbedding = Promise.withResolvers<{
            readonly vector: ReadonlyArray<number>;
          }>();
          const vector = Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, () => 1);
          let activeEvaluations = 0;
          let maximumActiveEvaluations = 0;
          let evaluationCount = 0;

          const nativeRuntime: EmbeddingRuntime = {
            loadModel: () => {
              acquired.push("model");
              return Promise.resolve({
                embeddingVectorSize: EMBEDDING_MODEL_DIMENSIONS,
                createEmbeddingContext: () => {
                  acquired.push("context");
                  return Promise.resolve({
                    getEmbeddingFor: () => {
                      evaluationCount += 1;
                      activeEvaluations += 1;
                      maximumActiveEvaluations = Math.max(
                        maximumActiveEvaluations,
                        activeEvaluations,
                      );
                      if (evaluationCount === 1) {
                        firstEmbeddingStarted.resolve();
                        return firstEmbedding.promise.finally(() => {
                          activeEvaluations -= 1;
                        });
                      }
                      secondEmbeddingStarted.resolve();
                      return secondEmbedding.promise.finally(() => {
                        activeEvaluations -= 1;
                      });
                    },
                    dispose: () => {
                      disposed.push("context");
                      return Promise.resolve();
                    },
                  });
                },
                dispose: () => {
                  disposed.push("model");
                  return Promise.resolve();
                },
              });
            },
            dispose: () => {
              disposed.push("runtime");
              return Promise.resolve();
            },
          };
          const initializeRuntime = (): Promise<EmbeddingRuntime> => {
            acquired.push("runtime");
            runtimeStarted.resolve();
            return runtimeAcquisition.promise;
          };

          yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              yield* model.install;
              const firstFiber = yield* model
                .embed(["first"])
                .pipe(Effect.forkChild({ startImmediately: true }));
              yield* Effect.promise(() => runtimeStarted.promise);

              const secondAttempted = yield* Deferred.make<void>();
              const secondFiber = yield* Effect.gen(function* () {
                yield* Deferred.succeed(secondAttempted, undefined);
                return yield* model.embed(["second"]);
              }).pipe(Effect.forkChild({ startImmediately: true }));
              yield* Deferred.await(secondAttempted);

              runtimeAcquisition.resolve(nativeRuntime);
              yield* Effect.promise(() => firstEmbeddingStarted.promise);
              assert.deepEqual(acquired, ["runtime", "model", "context"]);
              assert.strictEqual(evaluationCount, 1);

              firstEmbedding.resolve({ vector });
              yield* Effect.promise(() => secondEmbeddingStarted.promise);
              assert.strictEqual(maximumActiveEvaluations, 1);
              assert.strictEqual(activeEvaluations, 1);

              secondEmbedding.resolve({ vector });
              const first = yield* Fiber.join(firstFiber);
              const second = yield* Fiber.join(secondFiber);
              assert.strictEqual(first[0]?.length, EMBEDDING_MODEL_DIMENSIONS);
              assert.strictEqual(second[0]?.length, EMBEDDING_MODEL_DIMENSIONS);
              assert.strictEqual(activeEvaluations, 0);
              assert.deepEqual(acquired, ["runtime", "model", "context"]);
              assert.deepEqual(disposed, []);
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
          );

          assert.deepEqual(disposed, ["context", "model", "runtime"]);
        }),
      ),
    ),
  );

  it.effect("coordinates interruption and finalization around active native work", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-interruption-",
          });
          const acquired: Array<string> = [];
          const disposed: Array<string> = [];
          const embeddingStarted = Promise.withResolvers<void>();
          const pendingEmbedding = Promise.withResolvers<{
            readonly vector: ReadonlyArray<number>;
          }>();
          const vector = Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, () => 1);
          let embeddingSettled = false;
          let evaluationCount = 0;
          const initializeRuntime = (): Promise<EmbeddingRuntime> => {
            acquired.push("runtime");
            return Promise.resolve({
              loadModel: () => {
                acquired.push("model");
                return Promise.resolve({
                  embeddingVectorSize: EMBEDDING_MODEL_DIMENSIONS,
                  createEmbeddingContext: () => {
                    acquired.push("context");
                    return Promise.resolve({
                      getEmbeddingFor: () => {
                        evaluationCount += 1;
                        embeddingStarted.resolve();
                        return pendingEmbedding.promise.finally(() => {
                          embeddingSettled = true;
                        });
                      },
                      dispose: () => {
                        disposed.push("context");
                        return Promise.resolve();
                      },
                    });
                  },
                  dispose: () => {
                    disposed.push("model");
                    return Promise.resolve();
                  },
                });
              },
              dispose: () => {
                disposed.push("runtime");
                return Promise.resolve();
              },
            });
          };
          const runtime = ManagedRuntime.make(
            makeEmbeddingModelLive({
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            }).pipe(
              Layer.provide(
                ConfigProvider.layer(
                  ConfigProvider.fromEnv({ env: { XDG_CACHE_HOME: cacheRoot } }),
                ),
              ),
              Layer.provideMerge(BunServices.layer),
            ),
          );

          yield* Effect.gen(function* () {
            const context = yield* runtime.contextEffect;
            const model = Context.get(context, EmbeddingModel);
            yield* model.install;
            const activeFiber = yield* model
              .embed(["first", "second"])
              .pipe(Effect.forkChild({ startImmediately: true }));
            yield* Effect.promise(() => embeddingStarted.promise);

            const waitingAttempted = yield* Deferred.make<void>();
            const waitingInterrupted = yield* Deferred.make<void>();
            const waitingFiber = yield* Effect.gen(function* () {
              yield* Deferred.succeed(waitingAttempted, undefined);
              return yield* model.embed(["waiting"]);
            }).pipe(
              Effect.onInterrupt(() => Deferred.succeed(waitingInterrupted, undefined)),
              Effect.forkChild({ startImmediately: true }),
            );
            yield* Deferred.await(waitingAttempted);
            yield* Effect.yieldNow;
            yield* Fiber.interrupt(waitingFiber);
            yield* Deferred.await(waitingInterrupted);
            assert.strictEqual(evaluationCount, 1);

            const disposalStarted = yield* Deferred.make<void>();
            const disposalCompleted = yield* Deferred.make<void>();
            const disposalFiber = yield* Effect.gen(function* () {
              yield* Deferred.succeed(disposalStarted, undefined);
              yield* runtime.disposeEffect;
              yield* Deferred.succeed(disposalCompleted, undefined);
            }).pipe(Effect.forkChild({ startImmediately: true }));
            yield* Deferred.await(disposalStarted);

            const interruptionCompleted = yield* Deferred.make<void>();
            const interruptionFiber = yield* Fiber.interrupt(activeFiber).pipe(
              Effect.andThen(Deferred.succeed(interruptionCompleted, undefined)),
              Effect.forkChild({ startImmediately: true }),
            );
            yield* Effect.yieldNow;

            const interruptedBeforeSettlement = yield* Deferred.poll(interruptionCompleted);
            const disposedBeforeSettlement = yield* Deferred.poll(disposalCompleted);
            assert.isTrue(Option.isNone(interruptedBeforeSettlement));
            assert.isTrue(Option.isNone(disposedBeforeSettlement));
            assert.isFalse(embeddingSettled);
            assert.deepEqual(disposed, []);

            pendingEmbedding.resolve({ vector });
            yield* Fiber.join(interruptionFiber);
            yield* Fiber.join(disposalFiber);

            assert.isTrue(embeddingSettled);
            assert.strictEqual(evaluationCount, 1);
            assert.deepEqual(acquired, ["runtime", "model", "context"]);
            assert.deepEqual(disposed, ["context", "model", "runtime"]);
          }).pipe(Effect.ensuring(runtime.disposeEffect));
        }),
      ),
    ),
  );

  it.effect("does not retry a failed acquisition within the same layer lifetime", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-acquisition-failure-",
          });
          const acquired: Array<string> = [];
          const disposed: Array<string> = [];
          const initializeRuntime = (): Promise<EmbeddingRuntime> => {
            acquired.push("runtime");
            return Promise.resolve({
              loadModel: () => {
                acquired.push("model");
                return Promise.resolve({
                  embeddingVectorSize: 1,
                  createEmbeddingContext: () => {
                    acquired.push("unexpected-context");
                    return Promise.reject("context creation must not run");
                  },
                  dispose: () => {
                    disposed.push("model");
                    return Promise.resolve();
                  },
                });
              },
              dispose: () => {
                disposed.push("runtime");
                return Promise.resolve();
              },
            });
          };

          const failures = yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              yield* model.install;
              const first = yield* model.embed(["first"]).pipe(Effect.flip);
              const second = yield* model.embed(["second"]).pipe(Effect.flip);
              return [first, second];
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
          );

          assert.instanceOf(failures[0], EmbeddingRuntimeError);
          assert.instanceOf(failures[1], EmbeddingRuntimeError);
          assert.strictEqual(
            failures[0]?.message,
            `Embedding model dimension 1 does not match ${EMBEDDING_MODEL_DIMENSIONS}`,
          );
          assert.strictEqual(
            failures[1]?.message,
            `Embedding model dimension 1 does not match ${EMBEDDING_MODEL_DIMENSIONS}`,
          );
          assert.deepEqual(acquired, ["runtime", "model"]);
          assert.deepEqual(disposed, ["model", "runtime"]);
        }),
      ),
    ),
  );

  it.effect("keeps vector validation active for every call on a reused session", () =>
    withBunServices(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cacheRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-live-vector-validation-",
          });
          let embeddingCount = 0;
          const disposed: Array<string> = [];
          const initializeRuntime = (): Promise<EmbeddingRuntime> =>
            Promise.resolve({
              loadModel: () =>
                Promise.resolve({
                  embeddingVectorSize: EMBEDDING_MODEL_DIMENSIONS,
                  createEmbeddingContext: () =>
                    Promise.resolve({
                      getEmbeddingFor: () => {
                        embeddingCount += 1;
                        return Promise.resolve({
                          vector:
                            embeddingCount === 1
                              ? [1]
                              : Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
                                  index === 0 ? Number.NaN : 1,
                                ),
                        });
                      },
                      dispose: () => {
                        disposed.push("context");
                        return Promise.resolve();
                      },
                    }),
                  dispose: () => {
                    disposed.push("model");
                    return Promise.resolve();
                  },
                }),
              dispose: () => {
                disposed.push("runtime");
                return Promise.resolve();
              },
            });

          const failures = yield* provideLiveModel(
            Effect.gen(function* () {
              const model = yield* EmbeddingModel;
              yield* model.install;
              const wrongDimension = yield* model.embed(["first"]).pipe(Effect.flip);
              const nonFinite = yield* model.embed(["second"]).pipe(Effect.flip);
              assert.deepEqual(disposed, []);
              return [wrongDimension, nonFinite];
            }),
            {
              resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
              initializeRuntime,
              artifactSha256: validArtifactSha256,
            },
            { XDG_CACHE_HOME: cacheRoot },
          );

          assert.strictEqual(
            failures[0]?.message,
            `Embedding vector 0 has dimension 1; expected ${EMBEDDING_MODEL_DIMENSIONS}`,
          );
          assert.strictEqual(failures[1]?.message, "Embedding vector 0 contains non-finite values");
          assert.deepEqual(disposed, ["context", "model", "runtime"]);
        }),
      ),
    ),
  );

  it.effect("provides local inspection, idempotent installation, and bounded fake embeddings", () =>
    withModel(
      Effect.gen(function* () {
        const model = yield* EmbeddingModel;
        const before = yield* model.inspect;
        const first = yield* model.install;
        const second = yield* model.install;
        const after = yield* model.inspect;
        const vectors = yield* model.embed(["one", "three"]);
        const tooLarge = yield* model
          .embed(Array.from({ length: MAX_EMBEDDING_BATCH_SIZE + 1 }, () => "text"))
          .pipe(Effect.flip);

        assert.strictEqual(before.status, "missing");
        assert.strictEqual(first.status, "downloaded");
        assert.strictEqual(second.status, "already_available");
        assert.strictEqual(after.status, "available");
        assert.strictEqual(vectors.length, 2);
        assert.strictEqual(vectors[0]?.length, EMBEDDING_MODEL_DIMENSIONS);
        assert.instanceOf(tooLarge, EmbeddingBatchError);
      }),
      makeFakeEmbeddingModelLayer({ initiallyAvailable: false }),
    ),
  );

  it.effect(
    "initializes only after provisioning and reports idempotent model and ignore state",
    () =>
      withModel(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const tempRoot = yield* fs.makeTempDirectoryScoped({
              prefix: "agentic-memory-model-init-",
            });
            const vaultPath = path.join(tempRoot, "vault");

            const first = yield* initVaultFromTemplate({
              targetPath: vaultPath,
              initializeGit: false,
              yes: true,
            });
            const second = yield* initVaultFromTemplate({
              targetPath: vaultPath,
              initializeGit: false,
              yes: true,
            });
            const gitIgnore = yield* fs.readFileString(path.join(vaultPath, ".gitignore"));

            assert.strictEqual(first.status, "initialized");
            assert.strictEqual(first.model.installation, "downloaded");
            assert.isFalse(first.changes.updatedGitIgnore);
            assert.strictEqual(second.status, "already_initialized");
            assert.strictEqual(second.model.installation, "already_available");
            assert.isFalse(second.changes.updatedGitIgnore);
            assert.strictEqual(
              gitIgnore.split("\n").filter((line) => line === ".agentic-memory/index/").length,
              1,
            );
          }),
        ),
        makeFakeEmbeddingModelLayer({ initiallyAvailable: false }),
      ),
  );

  it.effect("leaves an absent target absent when model provisioning fails", () =>
    withModel(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-model-failure-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const failure = yield* initVaultFromTemplate({
            targetPath: vaultPath,
            initializeGit: false,
            yes: true,
          }).pipe(Effect.flip);
          const targetExists = yield* fs.exists(vaultPath);

          assert.strictEqual(failure.message, "Simulated interrupted model download");
          assert.isFalse(targetExists);
        }),
      ),
      makeFakeEmbeddingModelLayer({
        initiallyAvailable: false,
        installError: EmbeddingModelDownloadError.make({
          message: "Simulated interrupted model download",
        }),
      }),
    ),
  );

  it.effect("repairs the semantic index ignore entry in an existing compatible vault", () =>
    withModel(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-existing-vault-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          yield* initVaultFromTemplate({
            targetPath: vaultPath,
            initializeGit: false,
            yes: true,
          });
          yield* fs.writeFileString(path.join(vaultPath, ".gitignore"), ".DS_Store\n");

          const repaired = yield* initVaultFromTemplate({
            targetPath: vaultPath,
            initializeGit: false,
            yes: true,
          });
          const repeated = yield* initVaultFromTemplate({
            targetPath: vaultPath,
            initializeGit: false,
            yes: true,
          });
          const gitIgnore = yield* fs.readFileString(path.join(vaultPath, ".gitignore"));

          assert.isTrue(repaired.changes.updatedGitIgnore);
          assert.isFalse(repeated.changes.updatedGitIgnore);
          assert.strictEqual(gitIgnore, ".DS_Store\n.agentic-memory/index/\n");
        }),
      ),
      makeFakeEmbeddingModelLayer(),
    ),
  );
});
