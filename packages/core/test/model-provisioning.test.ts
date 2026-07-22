import { createHash } from "node:crypto";
import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Fiber, FileSystem, Layer, ManagedRuntime, Path } from "effect";
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
type BunRequirements = Exclude<ModelProvisioningRequirements, EmbeddingModel>;

const withModel = <A, E, R>(
  effect: Effect.Effect<A, E, R | ModelProvisioningRequirements>,
  modelLayer: Layer.Layer<EmbeddingModel>,
) => {
  const runtime = ManagedRuntime.make(Layer.merge(BunServices.layer, modelLayer));
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
      Effect.mapError(
        (cause) =>
          new EmbeddingModelDownloadError({
            message: "Failed to write the fake model download",
            cause,
          }),
      ),
    );
    return stagedPath;
  });

const provideLiveModel = <A, E, R>(
  effect: Effect.Effect<A, E, R | ModelProvisioningRequirements>,
  options: EmbeddingModelLiveOptions,
  env: Readonly<Record<string, string>>,
) => {
  const runtime = ManagedRuntime.make(
    makeEmbeddingModelLive(options).pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
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
          new EmbeddingRuntimeError({
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
                Effect.mapError(
                  (cause) =>
                    new EmbeddingModelDownloadError({
                      message: "Failed to write the fake model download",
                      cause,
                    }),
                ),
              );
              stagedArtifactExisted = yield* fs.exists(stagedPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new EmbeddingModelDownloadError({
                      message: "Failed to inspect the fake staged artifact",
                      cause,
                    }),
                ),
              );
              canonicalArtifactExisted = yield* fs.exists(canonicalArtifact(path, cacheRoot)).pipe(
                Effect.mapError(
                  (cause) =>
                    new EmbeddingModelDownloadError({
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
              Effect.mapError(
                (cause) =>
                  new EmbeddingModelDownloadError({
                    message: "Failed to write the partial fake download",
                    cause,
                  }),
              ),
              Effect.andThen(
                Effect.fail(
                  new EmbeddingModelDownloadError({
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
            releaseCancellation.promise.then(() => {
              cancellationCompleted = true;
              cancellationSettled.resolve();
              resume(
                Effect.fail(
                  new EmbeddingModelDownloadError({
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

  it.effect(
    "finalizes context, model, and runtime on success, typed failure, and interruption",
    () =>
      withBunServices(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const tempRoot = yield* fs.makeTempDirectoryScoped({
              prefix: "agentic-memory-live-finalizers-",
            });
            type Scenario = "success" | "wrong_dimension" | "non_finite" | "interruption";
            const scenarios: ReadonlyArray<Scenario> = [
              "success",
              "wrong_dimension",
              "non_finite",
              "interruption",
            ];

            yield* Effect.forEach(scenarios, (scenario) => {
              const disposed: Array<string> = [];
              const embeddingStarted = Promise.withResolvers<void>();
              const pendingEmbedding = Promise.withResolvers<{
                readonly vector: ReadonlyArray<number>;
              }>();
              const initializeRuntime = (): Promise<EmbeddingRuntime> =>
                Promise.resolve({
                  loadModel: () =>
                    Promise.resolve({
                      embeddingVectorSize: EMBEDDING_MODEL_DIMENSIONS,
                      createEmbeddingContext: () =>
                        Promise.resolve({
                          getEmbeddingFor: () => {
                            embeddingStarted.resolve();
                            if (scenario === "interruption") {
                              return pendingEmbedding.promise;
                            }
                            return Promise.resolve({
                              vector:
                                scenario === "wrong_dimension"
                                  ? [1]
                                  : Array.from(
                                      { length: EMBEDDING_MODEL_DIMENSIONS },
                                      (_, index) =>
                                        scenario === "non_finite" && index === 0 ? Number.NaN : 1,
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
              const cacheRoot = path.join(tempRoot, scenario);

              return provideLiveModel(
                Effect.gen(function* () {
                  const model = yield* EmbeddingModel;
                  yield* model.install;

                  if (scenario === "success") {
                    const vectors = yield* model.embed(["memory"]);
                    assert.strictEqual(vectors[0]?.length, EMBEDDING_MODEL_DIMENSIONS);
                  } else if (scenario === "wrong_dimension" || scenario === "non_finite") {
                    const failure = yield* model.embed(["memory"]).pipe(Effect.flip);
                    assert.instanceOf(failure, EmbeddingRuntimeError);
                    assert.strictEqual(
                      failure.message,
                      scenario === "wrong_dimension"
                        ? `Embedding vector 0 has dimension 1; expected ${EMBEDDING_MODEL_DIMENSIONS}`
                        : "Embedding vector 0 contains non-finite values",
                    );
                  } else {
                    const fiber = yield* model
                      .embed(["memory"])
                      .pipe(Effect.forkChild({ startImmediately: true }));
                    yield* Effect.promise(() => embeddingStarted.promise);
                    yield* Fiber.interrupt(fiber);
                  }

                  assert.deepEqual(disposed, ["context", "model", "runtime"]);
                }),
                {
                  resolveModelFile: makeArtifactResolver(fs, path, validArtifact),
                  initializeRuntime,
                  artifactSha256: validArtifactSha256,
                },
                { XDG_CACHE_HOME: cacheRoot },
              );
            });
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
        installError: new EmbeddingModelDownloadError({
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
