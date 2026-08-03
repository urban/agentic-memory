#!/usr/bin/env bun

import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import { createClient } from "@libsql/client";
import {
  Config,
  Console,
  Effect,
  FileSystem,
  ManagedRuntime,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { requireSemanticStackProbeSynthesisEndpoint } from "./SemanticStackProbeConfiguration.ts";
import { decodeSemanticStackProbeVaultStatus } from "./SemanticStackProbeStatus.ts";
import { decodeRecallSuccessJson } from "../src/recall/Recall.ts";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_SHA256,
  EMBEDDING_MODEL_URI,
} from "../src/semantic/EmbeddingModel.ts";
import { SemanticIndexResult } from "../src/semantic/SemanticIndex.ts";

class ProbePrerequisiteError extends Schema.TaggedErrorClass<ProbePrerequisiteError>()(
  "ProbePrerequisiteError",
  { message: Schema.String },
) {}

class ProbeInvariantError extends Schema.TaggedErrorClass<ProbeInvariantError>()(
  "ProbeInvariantError",
  { message: Schema.String },
) {}

class ProbeOperationError extends Schema.TaggedErrorClass<ProbeOperationError>()(
  "ProbeOperationError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const IndexResultJson = Schema.fromJsonString(SemanticIndexResult).annotate({
  identifier: "SemanticStackProbeIndexResultJson",
});
const IndexCountRow = Schema.Struct({
  document_count: Schema.Int,
  chunk_count: Schema.Int,
}).annotate({ identifier: "SemanticStackProbeIndexCountRow" });
const VectorRow = Schema.Struct({
  embedding: Schema.String,
}).annotate({ identifier: "SemanticStackProbeVectorRow" });
const VectorJson = Schema.fromJsonString(Schema.Array(Schema.Finite)).annotate({
  identifier: "SemanticStackProbeVectorJson",
});

const decodeIndexResult = Schema.decodeUnknownEffect(IndexResultJson);
const decodeIndexCountRow = Schema.decodeUnknownEffect(IndexCountRow);
const decodeVectorRow = Schema.decodeUnknownEffect(VectorRow);
const decodeVector = Schema.decodeUnknownEffect(VectorJson);

const lifecyclePrefix = "[agentic-memory:semantic-probe] ";
const expectedLifecycle = [
  "runtime_acquired",
  "model_acquired",
  "context_acquired",
  "context_disposed",
  "model_disposed",
  "runtime_disposed",
];

const requireProbe = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(new ProbeInvariantError({ message }));

const operation =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ProbeOperationError, R> =>
    effect.pipe(Effect.mapError((cause) => new ProbeOperationError({ message, cause })));

const lifecycleEvents = (stderr: string): ReadonlyArray<string> =>
  stderr
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(lifecyclePrefix))
    .map((line) => line.slice(lifecyclePrefix.length).split(" ")[0] ?? "");

const validateLifecycle = Effect.fnUntraced(function* (commandName: string, stderr: string) {
  const events = lifecycleEvents(stderr);
  yield* requireProbe(
    events.length === expectedLifecycle.length &&
      events.every((event, index) => event === expectedLifecycle[index]),
    `${commandName} lifecycle was ${events.join(", ")}; expected ${expectedLifecycle.join(", ")}`,
  );
  const runtimeLine = stderr
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`${lifecyclePrefix}runtime_acquired`));
  yield* requireProbe(
    runtimeLine !== undefined &&
      runtimeLine.includes("buildType=prebuilt") &&
      runtimeLine.includes("gpu=metal") &&
      runtimeLine.includes("llamaCppRepo=ggml-org/llama.cpp") &&
      !runtimeLine.includes("unreported"),
    `${commandName} did not report the expected prebuilt Metal llama.cpp runtime metadata`,
  );
  return runtimeLine;
});

const noteContent = (index: number): string => {
  const sequence = String(index).padStart(2, "0");
  return `---
type: note
status: active
maturity: evergreen
created: 2026-07-28
updated: 2026-07-28
summary: "Sustained embedding lifecycle proof document ${sequence}."
aliases: []
tags: []
sources: []
---

# Sustained Lifecycle Proof ${sequence}

Probe document ${sequence} confirms that durable Agentic Memory notes are embedded through one reusable native session during a multi-document index run.
`;
};

const cliMainPath = fileURLToPath(new URL("../../cli/src/main.ts", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const runCli = Effect.fnUntraced(function* (
  args: ReadonlyArray<string>,
  synthesisEndpoint: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make("bun", [cliMainPath, ...args], {
    cwd: repositoryRoot,
    env: {
      AGENTIC_MEMORY_SEMANTIC_PROBE: "1",
      AGENTIC_MEMORY_SYNTHESIS_URL: synthesisEndpoint,
      GGML_METAL_NO_RESIDENCY: undefined,
    },
    extendEnv: true,
  });
  const startedAt = performance.now();
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode };
    }),
  ).pipe(operation(`Failed to execute agentic-memory ${args[0] ?? "command"}`));
  return {
    ...result,
    durationMs: performance.now() - startedAt,
  };
});

const requireCommandSuccess = Effect.fnUntraced(function* (
  commandName: string,
  result: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: ChildProcessSpawner.ExitCode;
    readonly durationMs: number;
  },
) {
  yield* requireProbe(
    result.exitCode === ChildProcessSpawner.ExitCode(0),
    `${commandName} exited ${result.exitCode}: ${result.stderr.trim()}`,
  );
  return result;
});

const inspectStoredVectors = Effect.fnUntraced(function* (databasePath: string) {
  const path = yield* Path.Path;
  const databaseUrl = yield* path
    .toFileUrl(databasePath)
    .pipe(operation("Failed to encode the semantic index database path"));
  const client = yield* Effect.try({
    try: () => createClient({ url: databaseUrl.href, intMode: "number" }),
    catch: (cause) =>
      new ProbeOperationError({ message: "Failed to open the semantic index database", cause }),
  });

  return yield* Effect.gen(function* () {
    const countsResult = yield* Effect.tryPromise({
      try: () =>
        client.execute(`SELECT
          (SELECT COUNT(*) FROM documents) AS document_count,
          (SELECT COUNT(*) FROM chunks) AS chunk_count`),
      catch: (cause) =>
        new ProbeOperationError({ message: "Failed to inspect semantic index counts", cause }),
    });
    const countRow = countsResult.rows[0];
    if (countRow === undefined) {
      return yield* new ProbeInvariantError({ message: "Semantic index counts were omitted" });
    }
    const counts = yield* decodeIndexCountRow(countRow).pipe(
      operation("Semantic index counts were invalid"),
    );

    const vectorResult = yield* Effect.tryPromise({
      try: () => client.execute("SELECT vector_extract(embedding) AS embedding FROM chunks"),
      catch: (cause) =>
        new ProbeOperationError({ message: "Failed to extract stored semantic vectors", cause }),
    });
    const vectors = yield* Effect.forEach(vectorResult.rows, (row) =>
      decodeVectorRow(row).pipe(
        Effect.flatMap((decoded) => decodeVector(decoded.embedding)),
        operation("A stored semantic vector was invalid"),
      ),
    );
    yield* requireProbe(
      vectors.length === counts.chunk_count,
      `Extracted ${vectors.length} vectors for ${counts.chunk_count} chunks`,
    );
    yield* requireProbe(
      vectors.every(
        (vector) => vector.length === EMBEDDING_MODEL_DIMENSIONS && vector.every(Number.isFinite),
      ),
      "A stored semantic vector was not 768-dimensional and finite",
    );
    return {
      documentCount: counts.document_count,
      chunkCount: counts.chunk_count,
      validatedVectorCount: vectors.length,
    };
  }).pipe(Effect.ensuring(Effect.sync(() => client.close())));
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const optIn = yield* Config.string("AGENTIC_MEMORY_SEMANTIC_PROBE").pipe(Config.option);
    if (!Option.contains(optIn, "1")) {
      return yield* new ProbePrerequisiteError({
        message:
          "Set AGENTIC_MEMORY_SEMANTIC_PROBE=1 to run the model/native production-composition probe.",
      });
    }

    const residencyGuard = yield* Config.string("GGML_METAL_NO_RESIDENCY").pipe(Config.option);
    if (Option.isSome(residencyGuard)) {
      return yield* new ProbePrerequisiteError({
        message: "Unset GGML_METAL_NO_RESIDENCY before running the sustained lifecycle proof.",
      });
    }
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      return yield* new ProbePrerequisiteError({
        message: `The sustained lifecycle proof requires darwin-arm64; received ${process.platform}-${process.arch}.`,
      });
    }
    const synthesisEndpointConfig = yield* Config.string("AGENTIC_MEMORY_SYNTHESIS_URL").pipe(
      Config.option,
    );
    const synthesisEndpoint = yield* requireSemanticStackProbeSynthesisEndpoint(
      Option.getOrUndefined(synthesisEndpointConfig),
    ).pipe(Effect.mapError((cause) => new ProbePrerequisiteError({ message: cause.message })));

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "agentic-memory-sustained-lifecycle-",
    });
    const vaultPath = path.join(tempRoot, "vault");

    const init = yield* runCli(["init", vaultPath, "--yes", "--json"], synthesisEndpoint).pipe(
      Effect.flatMap((result) => requireCommandSuccess("init", result)),
    );
    yield* Effect.forEach(
      Array.from({ length: 32 }, (_, index) => index + 1),
      (index) =>
        fs
          .writeFileString(
            path.join(vaultPath, "notes", `lifecycle-proof-${index}.md`),
            noteContent(index),
          )
          .pipe(operation(`Failed to write sustained lifecycle note ${index}`)),
    );

    const index = yield* runCli(["index", "--vault", vaultPath, "--json"], synthesisEndpoint).pipe(
      Effect.flatMap((result) => requireCommandSuccess("index", result)),
    );
    const indexResult = yield* decodeIndexResult(index.stdout.trim()).pipe(
      operation("Index command output was invalid"),
    );
    yield* requireProbe(
      indexResult.status === "indexed",
      `Unexpected index status: ${indexResult.status}`,
    );
    yield* requireProbe(
      indexResult.files.new >= 30,
      `Index processed only ${indexResult.files.new} new managed documents`,
    );
    yield* requireProbe(
      indexResult.chunks.embedded >= 32,
      `Index generated only ${indexResult.chunks.embedded} embedding inputs`,
    );
    const indexRuntime = yield* validateLifecycle("index", index.stderr);

    const status = yield* runCli(
      ["status", "--vault", vaultPath, "--json"],
      synthesisEndpoint,
    ).pipe(Effect.flatMap((result) => requireCommandSuccess("status", result)));
    const statusResult = yield* decodeSemanticStackProbeVaultStatus(status.stdout.trim()).pipe(
      operation("Status command output was invalid"),
    );
    yield* requireProbe(
      statusResult.semanticReadiness.index.status === "current" && statusResult.recallReady,
      `Post-index readiness was ${statusResult.semanticReadiness.index.status}/${statusResult.recallReady}`,
    );
    const lockPath = path.join(vaultPath, ".agentic-memory", "index.lock");
    yield* requireProbe(
      !(yield* fs.exists(lockPath)),
      `Index lock remained after success: ${lockPath}`,
    );

    const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
    const stored = yield* inspectStoredVectors(databasePath);
    yield* requireProbe(
      stored.documentCount >= 30 && stored.chunkCount >= 32,
      `Stored proof was too small: ${stored.documentCount} documents and ${stored.chunkCount} chunks`,
    );

    const recall = yield* runCli(
      [
        "recall",
        "How does the sustained lifecycle probe embed durable notes?",
        "--vault",
        vaultPath,
        "--json",
      ],
      synthesisEndpoint,
    ).pipe(Effect.flatMap((result) => requireCommandSuccess("recall", result)));
    const recallResult = yield* decodeRecallSuccessJson(recall.stdout.trim()).pipe(
      operation("Recall command output was invalid"),
    );
    yield* requireProbe(
      recallResult.status === "answered" && recallResult.answer.length > 0,
      `Recall returned ${recallResult.status} without an answer`,
    );
    const recallRuntime = yield* validateLifecycle("recall", recall.stderr);
    yield* requireProbe(
      !(yield* fs.exists(lockPath)),
      `Index lock appeared after Recall: ${lockPath}`,
    );

    const bunVersion = process.versions.bun ?? "unreported";
    yield* requireProbe(bunVersion !== "unreported", "Bun version was unavailable");
    const peakRssMiB = process.resourceUsage().maxRSS / (1024 * 1024);

    yield* Console.log(
      [
        "Semantic stack sustained lifecycle probe: PASS",
        `bun=${bunVersion}`,
        "nodeLlamaCpp=3.19.1",
        `llamaCpp=${indexRuntime}`,
        `os=${process.platform} ${release()}`,
        `architecture=${process.arch}`,
        "GGML_METAL_NO_RESIDENCY=unset",
        `modelId=${EMBEDDING_MODEL_ID}`,
        `modelUri=${EMBEDDING_MODEL_URI}`,
        `modelSha256=${EMBEDDING_MODEL_SHA256}`,
        `dimensions=${EMBEDDING_MODEL_DIMENSIONS}`,
        `managedDocuments=${stored.documentCount}`,
        `embeddingInputs=${indexResult.chunks.embedded}`,
        `validatedStoredVectors=${stored.validatedVectorCount}`,
        `indexStatus=${statusResult.semanticReadiness.index.status}`,
        `recallReady=${statusResult.recallReady}`,
        "indexLockPresent=false",
        `indexLifecycle=${expectedLifecycle.join("->")}`,
        `recallRuntime=${recallRuntime}`,
        `initExitCode=${init.exitCode}`,
        `indexExitCode=${index.exitCode}`,
        `statusExitCode=${status.exitCode}`,
        `recallExitCode=${recall.exitCode}`,
        `initMs=${init.durationMs.toFixed(1)}`,
        `indexMs=${index.durationMs.toFixed(1)}`,
        `statusMs=${status.durationMs.toFixed(1)}`,
        `recallMs=${recall.durationMs.toFixed(1)}`,
        `probePeakRssMiB=${peakRssMiB.toFixed(1)}`,
        "--- init stdout ---",
        init.stdout.trim(),
        "--- init stderr ---",
        init.stderr.trim(),
        "--- index stdout ---",
        index.stdout.trim(),
        "--- index stderr ---",
        index.stderr.trim(),
        "--- status stdout ---",
        status.stdout.trim(),
        "--- status stderr ---",
        status.stderr.trim(),
        "--- recall stdout ---",
        recall.stdout.trim(),
        "--- recall stderr ---",
        recall.stderr.trim(),
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
