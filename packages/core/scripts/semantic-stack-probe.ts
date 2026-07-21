#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import { createClient } from "@libsql/client";
import { Config, Console, Effect, FileSystem, ManagedRuntime, Path, Schema, Stream } from "effect";
import { getLlama, resolveModelFile } from "node-llama-cpp";

const MODEL_URI = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const MODEL_FILE_NAME = "embeddinggemma-300M-Q8_0.gguf";
const MODEL_SHA256 = "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63";
const MODEL_DIMENSIONS = 768;

class ProbePrerequisiteError extends Schema.TaggedErrorClass<ProbePrerequisiteError>()(
  "ProbePrerequisiteError",
  { message: Schema.String },
) {}

class ProbeInvariantError extends Schema.TaggedErrorClass<ProbeInvariantError>()(
  "ProbeInvariantError",
  { message: Schema.String },
) {}

class ModelProbeError extends Schema.TaggedErrorClass<ModelProbeError>()("ModelProbeError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

class VectorProbeError extends Schema.TaggedErrorClass<VectorProbeError>()("VectorProbeError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const requireProbe = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(new ProbeInvariantError({ message }));

const modelOperation = <A>(message: string, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new ModelProbeError({ message, cause }),
  });

const vectorOperation = <A>(message: string, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new VectorProbeError({ message, cause }),
  });

const inspectArtifact = Effect.fnUntraced(function* (modelPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const digest = createHash("sha256");
  const magicBytes = new Uint8Array(4);
  let magicLength = 0;

  yield* fs.stream(modelPath).pipe(
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        digest.update(chunk);
        const remainingMagicBytes = 4 - magicLength;
        const copiedBytes = Math.min(remainingMagicBytes, chunk.length);
        magicBytes.set(chunk.subarray(0, copiedBytes), magicLength);
        magicLength += copiedBytes;
      }),
    ),
    Effect.mapError(
      (cause) => new ModelProbeError({ message: "Failed to inspect the model artifact", cause }),
    ),
  );

  return {
    magic: String.fromCharCode(...magicBytes),
    sha256: digest.digest("hex"),
  };
});

const probeModel = Effect.fnUntraced(function* (modelDirectory: string) {
  const fs = yield* FileSystem.FileSystem;
  const missingDirectory = yield* fs.makeTempDirectoryScoped({
    prefix: "agentic-memory-model-missing-",
  });
  const missingResolution = yield* Effect.result(
    modelOperation("Local-only missing-model resolution failed unexpectedly", () =>
      resolveModelFile(MODEL_URI, {
        directory: missingDirectory,
        download: false,
        cli: false,
      }),
    ),
  );
  yield* requireProbe(
    missingResolution._tag === "Failure",
    "Local-only resolution downloaded or resolved an absent model",
  );

  yield* fs
    .makeDirectory(modelDirectory, { recursive: true })
    .pipe(
      Effect.mapError(
        (cause) => new ModelProbeError({ message: "Failed to create the model cache", cause }),
      ),
    );
  const downloadedPath = yield* modelOperation("Failed to resolve or download the model", () =>
    resolveModelFile(MODEL_URI, {
      directory: modelDirectory,
      fileName: MODEL_FILE_NAME,
      cli: true,
    }),
  );
  const localPath = yield* modelOperation("Failed to resolve the cached model locally", () =>
    resolveModelFile(MODEL_URI, {
      directory: modelDirectory,
      fileName: MODEL_FILE_NAME,
      download: false,
      cli: false,
    }),
  );
  yield* requireProbe(
    localPath === downloadedPath,
    "Local-only resolution returned another artifact",
  );

  const artifact = yield* inspectArtifact(localPath);
  yield* requireProbe(artifact.magic === "GGUF", `Unexpected GGUF magic: ${artifact.magic}`);
  yield* requireProbe(
    artifact.sha256 === MODEL_SHA256,
    `Unexpected artifact SHA-256: ${artifact.sha256}`,
  );

  const loadStartedAt = performance.now();
  const embeddingResult = yield* Effect.scoped(
    Effect.gen(function* () {
      const llama = yield* Effect.acquireRelease(
        modelOperation("Failed to initialize node-llama-cpp", () => getLlama()),
        (resource) => Effect.promise(() => resource.dispose()),
      );
      const model = yield* Effect.acquireRelease(
        modelOperation("Failed to load EmbeddingGemma", () =>
          llama.loadModel({ modelPath: localPath }),
        ),
        (resource) => Effect.promise(() => resource.dispose()),
      );
      const context = yield* Effect.acquireRelease(
        modelOperation("Failed to create the embedding context", () =>
          model.createEmbeddingContext({ contextSize: 2048 }),
        ),
        (resource) => Effect.promise(() => resource.dispose()),
      );
      const modelLoadMs = performance.now() - loadStartedAt;
      const embeddingStartedAt = performance.now();
      const embedding = yield* modelOperation("Failed to create an embedding", () =>
        context.getEmbeddingFor(
          "title: compatibility probe | text: Agentic Memory keeps durable local context.",
        ),
      );
      return {
        dimensions: model.embeddingVectorSize,
        vector: embedding.vector,
        modelLoadMs,
        embeddingMs: performance.now() - embeddingStartedAt,
      };
    }),
  );

  yield* requireProbe(
    embeddingResult.dimensions === MODEL_DIMENSIONS,
    `Unexpected model dimensions: ${embeddingResult.dimensions}`,
  );
  yield* requireProbe(
    embeddingResult.vector.length === MODEL_DIMENSIONS,
    `Unexpected embedding length: ${embeddingResult.vector.length}`,
  );
  yield* requireProbe(
    embeddingResult.vector.every(Number.isFinite),
    "Embedding contains a non-finite value",
  );

  return {
    artifactPath: localPath,
    sha256: artifact.sha256,
    dimensions: embeddingResult.dimensions,
    modelLoadMs: embeddingResult.modelLoadMs,
    embeddingMs: embeddingResult.embeddingMs,
  };
});

const probeVectorStorage = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDirectory = yield* fs.makeTempDirectoryScoped({
    prefix: "agentic-memory-libsql-",
  });
  const databasePath = path.join(tempDirectory, "vectors.db");
  const client = createClient({ url: `file:${databasePath}` });

  const results = yield* Effect.gen(function* () {
    yield* vectorOperation("Failed to create the native vector table", () =>
      client.execute("CREATE TABLE vectors (id TEXT PRIMARY KEY, embedding F32_BLOB(3) NOT NULL)"),
    );
    yield* vectorOperation("Failed to insert native vectors", () =>
      client.batch(
        [
          ["INSERT INTO vectors VALUES (?, vector32(?))", ["exact", "[1,0,0]"]],
          ["INSERT INTO vectors VALUES (?, vector32(?))", ["near", "[0.8,0.2,0]"]],
          ["INSERT INTO vectors VALUES (?, vector32(?))", ["far", "[0,1,0]"]],
        ],
        "write",
      ),
    );
    const ranked = yield* vectorOperation("Failed to execute exact cosine top-K", () =>
      client.execute({
        sql: "SELECT id FROM vectors ORDER BY vector_distance_cos(embedding, vector32(?)), id LIMIT 2",
        args: ["[1,0,0]"],
      }),
    );
    yield* vectorOperation("Failed to update a native vector", () =>
      client.execute({
        sql: "UPDATE vectors SET embedding = vector32(?) WHERE id = ?",
        args: ["[0,1,0]", "near"],
      }),
    );
    const updated = yield* vectorOperation("Failed to verify the native vector update", () =>
      client.execute({
        sql: "SELECT vector_distance_cos(embedding, vector32(?)) AS distance FROM vectors WHERE id = ?",
        args: ["[1,0,0]", "near"],
      }),
    );
    yield* vectorOperation("Failed to delete a native vector", () =>
      client.execute({ sql: "DELETE FROM vectors WHERE id = ?", args: ["far"] }),
    );
    const remaining = yield* vectorOperation("Failed to verify native vector deletion", () =>
      client.execute("SELECT count(*) AS count FROM vectors"),
    );

    return {
      ranked: ranked.rows.map((row) => row.id),
      updatedDistance: updated.rows[0]?.distance,
      remainingCount: remaining.rows[0]?.count,
    };
  }).pipe(Effect.ensuring(Effect.sync(() => client.close())));

  yield* requireProbe(
    results.ranked[0] === "exact" && results.ranked[1] === "near",
    `Unexpected exact cosine top-K order: ${results.ranked.join(", ")}`,
  );
  yield* requireProbe(results.updatedDistance === 1, "Vector update was not persisted");
  yield* requireProbe(results.remainingCount === 2, "Vector deletion was not persisted");
  yield* requireProbe(client.closed, "libSQL client did not close");
  yield* fs
    .remove(databasePath)
    .pipe(
      Effect.mapError(
        (cause) => new VectorProbeError({ message: "Failed to remove the probe database", cause }),
      ),
    );
  const databaseStillExists = yield* fs.exists(databasePath);
  yield* requireProbe(!databaseStillExists, "Probe database cleanup did not complete");

  return { topK: results.ranked.join(","), clientClosed: client.closed, databaseRemoved: true };
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const optIn = yield* Config.string("AGENTIC_MEMORY_SEMANTIC_PROBE").pipe(
      Config.withDefault(""),
    );
    if (optIn !== "1") {
      return yield* new ProbePrerequisiteError({
        message:
          "Set AGENTIC_MEMORY_SEMANTIC_PROBE=1 to run the network/model/native integration probe.",
      });
    }

    const path = yield* Path.Path;
    const cacheRoot = yield* Config.string("XDG_CACHE_HOME").pipe(
      Config.withDefault(path.join(homedir(), ".cache")),
    );
    const modelDirectory = path.join(cacheRoot, "agentic-memory", "models");
    const model = yield* probeModel(modelDirectory);
    const vectors = yield* probeVectorStorage();
    const peakRssMiB = process.resourceUsage().maxRSS / (1024 * 1024);

    yield* Console.log(
      [
        "Semantic stack probe: PASS",
        "runtime=node-llama-cpp@3.19.1",
        "client=@libsql/client@0.17.4",
        "native=libsql@0.5.29",
        `modelUri=${MODEL_URI}`,
        `artifactPath=${model.artifactPath}`,
        `sha256=${model.sha256}`,
        `dimensions=${model.dimensions}`,
        `modelLoadMs=${model.modelLoadMs.toFixed(1)}`,
        `oneVectorMs=${model.embeddingMs.toFixed(1)}`,
        `peakRssMiB=${peakRssMiB.toFixed(1)}`,
        `topK=${vectors.topK}`,
        `clientClosed=${vectors.clientClosed}`,
        `databaseRemoved=${vectors.databaseRemoved}`,
      ].join("\n"),
    );
  }),
);

const ProbeRuntime = ManagedRuntime.make(BunServices.layer);

if (import.meta.main) {
  BunRuntime.runMain(
    ProbeRuntime.contextEffect.pipe(
      Effect.flatMap((context) => Effect.provideContext(program, context)),
      Effect.ensuring(ProbeRuntime.disposeEffect),
    ),
  );
}
