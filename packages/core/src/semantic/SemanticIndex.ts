import { createHash } from "node:crypto";
import { Clock, Effect, FileSystem, Path, Schema } from "effect";
import { parseManagedMemoryDocument, readManagedMemoryDocuments } from "../vault/ManagedMemory.ts";
import { isPathInsideRoot } from "../vault/VaultPathSafety.ts";
import { inspectInitializedVaultStructure } from "../vault/VaultStructure.ts";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EmbeddingModel,
} from "./EmbeddingModel.ts";
import {
  chunkManagedMemoryDocument,
  SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
} from "./MarkdownChunking.ts";
import {
  completeSemanticIndex,
  INDEX_SCHEMA_VERSION,
  initializeSemanticIndexRepository,
  markSemanticIndexIncomplete,
  readSemanticIndexDocuments,
  readSemanticIndexSnapshot,
  removeSemanticIndexDocuments,
  replaceSemanticIndexDocument,
} from "./SemanticIndexRepository.ts";

type ManagedMemoryDocument = import("../vault/ManagedMemory.ts").ManagedMemoryDocument;
type StoredIndexDocument = import("./SemanticIndexRepository.ts").StoredIndexDocument;
type StoredIndexSnapshot = import("./SemanticIndexRepository.ts").StoredIndexSnapshot;

export const SemanticIndexFileCounts = Schema.Struct({
  new: Schema.Int,
  changed: Schema.Int,
  deleted: Schema.Int,
  unchanged: Schema.Int,
}).annotate({ identifier: "SemanticIndexFileCounts" });
export type SemanticIndexFileCounts = typeof SemanticIndexFileCounts.Type;

export const SemanticIndexChunkCounts = Schema.Struct({
  embedded: Schema.Int,
  removed: Schema.Int,
}).annotate({ identifier: "SemanticIndexChunkCounts" });
export type SemanticIndexChunkCounts = typeof SemanticIndexChunkCounts.Type;

export const SemanticIndexResult = Schema.Struct({
  status: Schema.Literals(["indexed", "already_current", "deleted", "already_absent"]),
  vaultPath: Schema.String,
  files: SemanticIndexFileCounts,
  chunks: SemanticIndexChunkCounts,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "SemanticIndexResult" });
export type SemanticIndexResult = typeof SemanticIndexResult.Type;

export const SemanticIndexReadiness = Schema.Struct({
  status: Schema.Literals(["ready", "not_ready", "invalid"]),
  vault: Schema.Struct({
    status: Schema.Literals(["healthy", "invalid"]),
    path: Schema.String,
  }),
  model: Schema.Struct({
    status: Schema.Literals(["available", "missing", "invalid", "not_checked"]),
    id: Schema.Literal(EMBEDDING_MODEL_ID),
  }),
  index: Schema.Struct({
    status: Schema.Literals([
      "missing",
      "current",
      "stale",
      "incomplete",
      "incompatible",
      "invalid",
    ]),
    newFiles: Schema.Int,
    changedFiles: Schema.Int,
    deletedFiles: Schema.Int,
    unchangedFiles: Schema.Int,
  }),
  recallReady: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "SemanticIndexReadiness" });
export type SemanticIndexReadiness = typeof SemanticIndexReadiness.Type;

export class SemanticIndexError extends Schema.TaggedErrorClass<SemanticIndexError>()(
  "SemanticIndexError",
  {
    reason: Schema.Literals([
      "InvalidVaultPath",
      "InvalidVaultStructure",
      "ModelInspectionFailed",
      "ModelMissing",
      "IndexReadFailed",
      "IndexWriteFailed",
      "IncompatibleIndex",
      "IndexBusy",
      "InvalidEmbedding",
      "SemanticIndexNotReady",
      "DeleteFailed",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

interface IndexPaths {
  readonly controlPlaneDirectory: string;
  readonly indexDirectory: string;
  readonly databasePath: string;
  readonly lockDirectory: string;
}

interface SynchronizationPlan {
  readonly added: ReadonlyArray<ManagedMemoryDocument>;
  readonly changed: ReadonlyArray<ManagedMemoryDocument>;
  readonly deleted: ReadonlyArray<StoredIndexDocument>;
  readonly unchanged: ReadonlyArray<ManagedMemoryDocument>;
}

const zeroFiles = (): SemanticIndexFileCounts => ({
  new: 0,
  changed: 0,
  deleted: 0,
  unchanged: 0,
});

const invalidReadiness = (vaultPath: string, message: string): SemanticIndexReadiness => ({
  status: "invalid",
  vault: { status: "invalid", path: vaultPath },
  model: { status: "not_checked", id: EMBEDDING_MODEL_ID },
  index: {
    status: "invalid",
    newFiles: 0,
    changedFiles: 0,
    deletedFiles: 0,
    unchangedFiles: 0,
  },
  recallReady: false,
  warnings: [message],
});

const indexPaths = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<IndexPaths, SemanticIndexError, Path.Path> {
  const path = yield* Path.Path;
  if (!path.isAbsolute(vaultPath)) {
    return yield* new SemanticIndexError({
      reason: "InvalidVaultPath",
      message: `Vault path must be absolute: ${vaultPath}`,
    });
  }
  const indexDirectory = path.join(vaultPath, ".agentic-memory", "index");
  if (path.relative(vaultPath, indexDirectory) !== path.join(".agentic-memory", "index")) {
    return yield* new SemanticIndexError({
      reason: "InvalidVaultPath",
      message: "Refused unsafe semantic index path",
    });
  }
  return {
    controlPlaneDirectory: path.join(vaultPath, ".agentic-memory"),
    indexDirectory,
    databasePath: path.join(indexDirectory, "recall.db"),
    lockDirectory: path.join(vaultPath, ".agentic-memory", "index.lock"),
  };
});

const ensureDeletionPathsSafe = Effect.fnUntraced(function* (
  vaultPath: string,
  paths: IndexPaths,
): Effect.fn.Return<void, SemanticIndexError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vaultRealPath = yield* fs.realPath(vaultPath).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({
          reason: "DeleteFailed",
          message: "Failed to resolve the vault before semantic index deletion",
          cause,
        }),
    ),
  );

  for (const candidatePath of [
    paths.controlPlaneDirectory,
    paths.indexDirectory,
    paths.lockDirectory,
  ]) {
    const exists = yield* fs.exists(candidatePath).pipe(
      Effect.mapError(
        (cause) =>
          new SemanticIndexError({
            reason: "DeleteFailed",
            message: "Failed to inspect semantic index paths before deletion",
            cause,
          }),
      ),
    );
    if (!exists) {
      continue;
    }
    const candidateRealPath = yield* fs.realPath(candidatePath).pipe(
      Effect.mapError(
        (cause) =>
          new SemanticIndexError({
            reason: "DeleteFailed",
            message: "Failed to resolve semantic index paths before deletion",
            cause,
          }),
      ),
    );
    if (!isPathInsideRoot(vaultRealPath, candidateRealPath, path)) {
      return yield* new SemanticIndexError({
        reason: "DeleteFailed",
        message: "Refused unsafe semantic index deletion path outside the vault",
      });
    }
  }
});

const withIndexLock = <A, E, R>(
  paths: IndexPaths,
  failureReason: "IndexWriteFailed" | "DeleteFailed",
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SemanticIndexError, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* Effect.acquireRelease(
        fs.makeDirectory(paths.lockDirectory).pipe(
          Effect.mapError(
            (cause) =>
              new SemanticIndexError({
                reason: cause.reason._tag === "AlreadyExists" ? "IndexBusy" : failureReason,
                message:
                  cause.reason._tag === "AlreadyExists"
                    ? "Semantic index is busy; wait for the active operation to finish"
                    : "Failed to acquire the semantic index lock",
                cause,
              }),
          ),
        ),
        () => fs.remove(paths.lockDirectory, { recursive: true }).pipe(Effect.exit),
      );
      return yield* use;
    }),
  );

const loadInventory = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  ReadonlyArray<ManagedMemoryDocument>,
  SemanticIndexError,
  FileSystem.FileSystem | Path.Path
> {
  const documents = yield* readManagedMemoryDocuments(vaultPath).pipe(
    Effect.mapError((cause) => {
      const invalidStructure =
        cause.reason !== "ReadVaultFailed" || cause.cause?.reason._tag === "NotFound";
      return new SemanticIndexError({
        reason: invalidStructure ? "InvalidVaultStructure" : "IndexReadFailed",
        message: cause.message,
        cause: cause.cause,
      });
    }),
  );
  if (
    !documents.some(({ path }) => path === "MEMORY.md") ||
    !documents.some(({ path }) => path === "USER.md")
  ) {
    return yield* new SemanticIndexError({
      reason: "InvalidVaultStructure",
      message: "A semantic index vault must contain MEMORY.md and USER.md",
    });
  }
  return documents;
});

const inventoryFingerprint = (documents: ReadonlyArray<ManagedMemoryDocument>): string =>
  createHash("sha256")
    .update(documents.map(({ path, contentHash }) => `${path}\0${contentHash}`).join("\n"))
    .digest("hex");

const planSynchronization = (
  documents: ReadonlyArray<ManagedMemoryDocument>,
  snapshot: StoredIndexSnapshot,
): SynchronizationPlan => {
  const storedByPath = new Map(snapshot.documents.map((document) => [document.path, document]));
  const currentPaths = new Set(documents.map(({ path }) => path));
  return {
    added: documents.filter(({ path }) => !storedByPath.has(path)),
    changed: documents.filter(({ path, contentHash }) => {
      const stored = storedByPath.get(path);
      return stored !== undefined && stored.contentHash !== contentHash;
    }),
    deleted: snapshot.documents.filter(({ path }) => !currentPaths.has(path)),
    unchanged: documents.filter(({ path, contentHash }) => {
      const stored = storedByPath.get(path);
      return stored !== undefined && stored.contentHash === contentHash;
    }),
  };
};

const readinessCounts = (
  documents: ReadonlyArray<ManagedMemoryDocument>,
  snapshot: StoredIndexSnapshot,
) => {
  const plan = planSynchronization(documents, snapshot);
  return {
    newFiles: plan.added.length,
    changedFiles: plan.changed.length,
    deletedFiles: plan.deleted.length,
    unchangedFiles: plan.unchanged.length,
  };
};

const requireCompatibleSnapshot = (
  vaultPath: string,
  snapshot: StoredIndexSnapshot,
  repositoryOrigin: "fresh" | "existing",
): Effect.Effect<StoredIndexSnapshot, SemanticIndexError> => {
  const metadata = snapshot.metadata;
  const compatible =
    metadata === undefined
      ? repositoryOrigin === "fresh"
      : metadata.schemaVersion === INDEX_SCHEMA_VERSION &&
        metadata.compatibilityFingerprint === SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT;
  return compatible
    ? Effect.succeed(snapshot)
    : Effect.fail(
        new SemanticIndexError({
          reason: "IncompatibleIndex",
          message: `Semantic index at ${vaultPath} is incompatible; run agentic-memory index --vault ${vaultPath} --delete, then index again`,
        }),
      );
};

export const inspectSemanticIndex = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  SemanticIndexReadiness,
  SemanticIndexError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const pathsResult = yield* indexPaths(vaultPath).pipe(Effect.result);
  if (pathsResult._tag === "Failure") {
    return invalidReadiness(vaultPath, pathsResult.failure.message);
  }
  const paths = pathsResult.success;
  const structure = yield* inspectInitializedVaultStructure(vaultPath).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({
          reason: "IndexReadFailed",
          message: "Failed to inspect initialized vault structure",
          cause,
        }),
    ),
  );
  if (!structure.initialized) {
    const firstViolation = structure.violations[0];
    return invalidReadiness(
      vaultPath,
      firstViolation === undefined
        ? "Vault is not an initialized Agentic Memory vault"
        : firstViolation.reason === "missing"
          ? `Vault is missing ${firstViolation.label}: ${firstViolation.path}`
          : `Vault entry ${firstViolation.label} must be a ${firstViolation.expectedType.toLowerCase()}, but found ${firstViolation.actualType.toLowerCase()}: ${firstViolation.path}`,
    );
  }
  const inventoryResult = yield* loadInventory(vaultPath).pipe(Effect.result);
  if (inventoryResult._tag === "Failure") {
    return inventoryResult.failure.reason === "InvalidVaultStructure"
      ? invalidReadiness(vaultPath, inventoryResult.failure.message)
      : yield* inventoryResult.failure;
  }
  const documents = inventoryResult.success;
  const model = yield* EmbeddingModel;
  const modelInspection = yield* model.inspect.pipe(
    Effect.map((inspection) => inspection.status),
    Effect.catchTag(
      "InvalidEmbeddingArtifactError",
      (): Effect.Effect<"invalid"> => Effect.succeed("invalid"),
    ),
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({
          reason: "ModelInspectionFailed",
          message: cause.message,
          cause,
        }),
    ),
  );
  const exists = yield* fs.exists(paths.databasePath).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({
          reason: "IndexReadFailed",
          message: "Failed to inspect semantic index storage",
          cause,
        }),
    ),
  );
  const modelWarning =
    modelInspection === "missing"
      ? [`Embedding model ${EMBEDDING_MODEL_ID} is missing; run agentic-memory init ${vaultPath}`]
      : modelInspection === "invalid"
        ? [`Embedding model ${EMBEDDING_MODEL_ID} is invalid; run agentic-memory init ${vaultPath}`]
        : [];
  if (!exists) {
    return {
      status: "not_ready",
      vault: { status: "healthy", path: vaultPath },
      model: { status: modelInspection, id: EMBEDDING_MODEL_ID },
      index: {
        status: "missing",
        newFiles: documents.length,
        changedFiles: 0,
        deletedFiles: 0,
        unchangedFiles: 0,
      },
      recallReady: false,
      warnings: [
        ...modelWarning,
        `Semantic index is missing; run agentic-memory index --vault ${vaultPath}`,
      ],
    } satisfies SemanticIndexReadiness;
  }
  const snapshotResult = yield* readSemanticIndexSnapshot(paths.databasePath).pipe(Effect.result);
  if (snapshotResult._tag === "Failure") {
    if (snapshotResult.failure.reason === "InvalidData") {
      const storedDocumentsResult = yield* readSemanticIndexDocuments(paths.databasePath).pipe(
        Effect.result,
      );
      if (
        storedDocumentsResult._tag === "Failure" &&
        storedDocumentsResult.failure.reason !== "InvalidData"
      ) {
        return yield* new SemanticIndexError({
          reason: "IndexReadFailed",
          message: storedDocumentsResult.failure.message,
          cause: storedDocumentsResult.failure,
        });
      }
      const counts =
        storedDocumentsResult._tag === "Success"
          ? readinessCounts(documents, {
              metadata: undefined,
              documents: storedDocumentsResult.success,
            })
          : { newFiles: 0, changedFiles: 0, deletedFiles: 0, unchangedFiles: 0 };
      return {
        status: "not_ready",
        vault: { status: "healthy", path: vaultPath },
        model: { status: modelInspection, id: EMBEDDING_MODEL_ID },
        index: {
          status: "invalid",
          ...counts,
        },
        recallReady: false,
        warnings: [
          ...modelWarning,
          `Semantic index metadata is invalid; run agentic-memory index --vault ${vaultPath} --delete, then index again`,
        ],
      } satisfies SemanticIndexReadiness;
    }
    return yield* new SemanticIndexError({
      reason: "IndexReadFailed",
      message: snapshotResult.failure.message,
      cause: snapshotResult.failure,
    });
  }
  const snapshot = snapshotResult.success;
  const metadata = snapshot.metadata;
  const counts = readinessCounts(documents, snapshot);
  const metadataMissing = metadata === undefined;
  const incompatible =
    metadata !== undefined &&
    (metadata.schemaVersion !== INDEX_SCHEMA_VERSION ||
      metadata.compatibilityFingerprint !== SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT);
  const hasInventoryChanges =
    counts.newFiles > 0 || counts.changedFiles > 0 || counts.deletedFiles > 0;
  const inventoryMatches =
    metadata !== undefined && metadata.inventoryFingerprint === inventoryFingerprint(documents);
  const hasInvalidDocuments = snapshot.documents.some(
    ({ integrity }) => integrity === "chunk_count_mismatch",
  );
  const hasIncompleteDocuments = snapshot.documents.some(
    ({ integrity }) => integrity === "incomplete",
  );
  const indexStatus = metadataMissing
    ? "invalid"
    : incompatible
      ? "incompatible"
      : metadata.state === "incomplete"
        ? "incomplete"
        : hasInvalidDocuments
          ? "invalid"
          : hasIncompleteDocuments
            ? "incomplete"
            : hasInventoryChanges || !inventoryMatches
              ? "stale"
              : "current";
  const recallReady = modelInspection === "available" && indexStatus === "current";
  const indexWarning =
    indexStatus === "current"
      ? []
      : indexStatus === "incompatible" || indexStatus === "invalid"
        ? [
            `Semantic index is ${indexStatus}; run agentic-memory index --vault ${vaultPath} --delete, then index again`,
          ]
        : [`Semantic index is ${indexStatus}; run agentic-memory index --vault ${vaultPath}`];
  return {
    status: recallReady ? "ready" : "not_ready",
    vault: { status: "healthy", path: vaultPath },
    model: { status: modelInspection, id: EMBEDDING_MODEL_ID },
    index: { status: indexStatus, ...counts },
    recallReady,
    warnings: [...modelWarning, ...indexWarning],
  } satisfies SemanticIndexReadiness;
});

export const requireCurrentSemanticIndex = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  SemanticIndexReadiness,
  SemanticIndexError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path
> {
  const readiness = yield* inspectSemanticIndex(vaultPath);
  if (!readiness.recallReady) {
    return yield* new SemanticIndexError({
      reason: "SemanticIndexNotReady",
      message: readiness.warnings.join(" "),
    });
  }
  return readiness;
});

const embedDocument = Effect.fnUntraced(function* (
  document: ManagedMemoryDocument,
): Effect.fn.Return<
  import("./SemanticIndexRepository.ts").IndexedDocumentWrite,
  SemanticIndexError,
  EmbeddingModel
> {
  const parsed = parseManagedMemoryDocument(document);
  const chunks = chunkManagedMemoryDocument(parsed);
  const model = yield* EmbeddingModel;
  const batches: Array<ReadonlyArray<ReadonlyArray<number>>> = [];
  for (let offset = 0; offset < chunks.length; offset += 64) {
    const vectors = yield* model
      .embed(chunks.slice(offset, offset + 64).map(({ embeddingInput }) => embeddingInput))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason:
                cause._tag === "EmbeddingModelMissingError" ? "ModelMissing" : "InvalidEmbedding",
              message: cause.message,
              cause,
            }),
        ),
      );
    batches.push(vectors);
  }
  const vectors = batches.flat();
  if (
    vectors.length !== chunks.length ||
    vectors.some(
      (vector) => vector.length !== EMBEDDING_MODEL_DIMENSIONS || !vector.every(Number.isFinite),
    )
  ) {
    return yield* new SemanticIndexError({
      reason: "InvalidEmbedding",
      message: `Embedding model returned invalid vectors for ${document.path}`,
    });
  }
  const indexedChunks = yield* Effect.forEach(chunks, (chunk, index) => {
    const embedding = vectors[index];
    return embedding === undefined
      ? Effect.fail(
          new SemanticIndexError({
            reason: "InvalidEmbedding",
            message: `Embedding model omitted vector ${index} for ${document.path}`,
          }),
        )
      : Effect.succeed({
          id: createHash("sha256")
            .update(`${document.path}\0${chunk.ordinal}\0${chunk.textHash}`)
            .digest("hex"),
          ordinal: chunk.ordinal,
          headingPath: chunk.headingPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          textHash: chunk.textHash,
          embedding,
        });
  });
  return {
    path: document.path,
    contentHash: document.contentHash,
    memoryLayer: document.memoryLayer,
    contentStatus: parsed.status,
    projectStatus: parsed.projectStatus,
    title: parsed.title,
    chunks: indexedChunks,
  };
});

export const synchronizeSemanticIndex = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  SemanticIndexResult,
  SemanticIndexError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* indexPaths(vaultPath);
  yield* loadInventory(vaultPath);
  return yield* withIndexLock(
    paths,
    "IndexWriteFailed",
    Effect.gen(function* () {
      const documents = yield* loadInventory(vaultPath);
      const databaseExists = yield* fs.exists(paths.databasePath).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason: "IndexReadFailed",
              message: "Failed to inspect semantic index storage",
              cause,
            }),
        ),
      );

      yield* fs.makeDirectory(paths.indexDirectory, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason: "IndexWriteFailed",
              message: "Failed to create semantic index storage",
              cause,
            }),
        ),
      );
      if (!databaseExists) {
        yield* initializeSemanticIndexRepository(
          paths.databasePath,
          EMBEDDING_MODEL_DIMENSIONS,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new SemanticIndexError({
                reason: "IndexWriteFailed",
                message: cause.message,
                cause,
              }),
          ),
        );
      }

      const snapshot = yield* readSemanticIndexSnapshot(paths.databasePath).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason: databaseExists ? "IncompatibleIndex" : "IndexReadFailed",
              message: databaseExists
                ? `Semantic index at ${vaultPath} is incompatible; run agentic-memory index --vault ${vaultPath} --delete, then index again`
                : cause.message,
              cause,
            }),
        ),
        Effect.flatMap((current) =>
          requireCompatibleSnapshot(vaultPath, current, databaseExists ? "existing" : "fresh"),
        ),
      );
      const plan = planSynchronization(documents, snapshot);
      const currentFingerprint = inventoryFingerprint(documents);
      const alreadyCurrent =
        snapshot.metadata?.state === "complete" &&
        snapshot.metadata.inventoryFingerprint === currentFingerprint &&
        plan.added.length === 0 &&
        plan.changed.length === 0 &&
        plan.deleted.length === 0;
      if (alreadyCurrent) {
        return {
          status: "already_current",
          vaultPath,
          files: {
            new: 0,
            changed: 0,
            deleted: 0,
            unchanged: plan.unchanged.length,
          },
          chunks: { embedded: 0, removed: 0 },
          warnings: [],
        } satisfies SemanticIndexResult;
      }

      const model = yield* EmbeddingModel;
      const modelInspection = yield* model.inspect.pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason: "ModelInspectionFailed",
              message: cause.message,
              cause,
            }),
        ),
      );
      if (modelInspection.status === "missing") {
        return yield* new SemanticIndexError({
          reason: "ModelMissing",
          message: `Embedding model ${EMBEDDING_MODEL_ID} is not installed; run agentic-memory init first`,
        });
      }

      yield* markSemanticIndexIncomplete(
        paths.databasePath,
        SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({ reason: "IndexWriteFailed", message: cause.message, cause }),
        ),
      );

      const removedChunks = [...plan.changed, ...plan.deleted].reduce((total, document) => {
        const stored = snapshot.documents.find(({ path }) => path === document.path);
        return total + (stored?.chunkCount ?? 0);
      }, 0);
      yield* removeSemanticIndexDocuments(
        paths.databasePath,
        plan.deleted.map(({ path }) => path),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({ reason: "IndexWriteFailed", message: cause.message, cause }),
        ),
      );

      let embeddedChunks = 0;
      for (const document of [...plan.added, ...plan.changed]) {
        const indexed = yield* embedDocument(document);
        yield* replaceSemanticIndexDocument(paths.databasePath, indexed).pipe(
          Effect.mapError(
            (cause) =>
              new SemanticIndexError({ reason: "IndexWriteFailed", message: cause.message, cause }),
          ),
        );
        embeddedChunks += indexed.chunks.length;
      }

      const completedAtMs = yield* Clock.currentTimeMillis;
      yield* completeSemanticIndex(
        paths.databasePath,
        SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
        currentFingerprint,
        completedAtMs,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({ reason: "IndexWriteFailed", message: cause.message, cause }),
        ),
      );
      return {
        status: "indexed",
        vaultPath,
        files: {
          new: plan.added.length,
          changed: plan.changed.length,
          deleted: plan.deleted.length,
          unchanged: plan.unchanged.length,
        },
        chunks: { embedded: embeddedChunks, removed: removedChunks },
        warnings: [],
      } satisfies SemanticIndexResult;
    }),
  );
});

export const deleteSemanticIndex = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<SemanticIndexResult, SemanticIndexError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* indexPaths(vaultPath);
  yield* ensureDeletionPathsSafe(vaultPath, paths);
  return yield* withIndexLock(
    paths,
    "DeleteFailed",
    Effect.gen(function* () {
      const exists = yield* fs.exists(paths.indexDirectory).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason: "DeleteFailed",
              message: "Failed to inspect semantic index storage before deletion",
              cause,
            }),
        ),
      );
      if (!exists) {
        return {
          status: "already_absent",
          vaultPath,
          files: zeroFiles(),
          chunks: { embedded: 0, removed: 0 },
          warnings: [],
        } satisfies SemanticIndexResult;
      }
      yield* fs.remove(paths.indexDirectory, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new SemanticIndexError({
              reason: "DeleteFailed",
              message: "Failed to delete semantic index storage",
              cause,
            }),
        ),
      );
      return {
        status: "deleted",
        vaultPath,
        files: zeroFiles(),
        chunks: { embedded: 0, removed: 0 },
        warnings: [],
      } satisfies SemanticIndexResult;
    }),
  );
});
