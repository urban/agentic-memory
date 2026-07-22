import { createHash } from "node:crypto";
import { Clock, Effect, FileSystem, Path, Schema } from "effect";
import { parseManagedMemoryDocument, readManagedMemoryDocuments } from "../vault/ManagedMemory.ts";
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
  readSemanticIndexSnapshot,
  replaceSemanticIndexDocument,
} from "./SemanticIndexRepository.ts";

type ManagedMemoryDocument = import("../vault/ManagedMemory.ts").ManagedMemoryDocument;

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

export const SemanticIndexInspection = Schema.Struct({
  status: Schema.Literals(["missing", "complete", "incomplete", "incompatible"]),
  vaultPath: Schema.String,
}).annotate({ identifier: "SemanticIndexInspection" });
export type SemanticIndexInspection = typeof SemanticIndexInspection.Type;

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
      "InvalidEmbedding",
      "DeleteFailed",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

interface IndexPaths {
  readonly indexDirectory: string;
  readonly databasePath: string;
}

const zeroFiles = (): SemanticIndexFileCounts => ({
  new: 0,
  changed: 0,
  deleted: 0,
  unchanged: 0,
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
  return { indexDirectory, databasePath: path.join(indexDirectory, "recall.db") };
});

const loadInventory = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  ReadonlyArray<ManagedMemoryDocument>,
  SemanticIndexError,
  FileSystem.FileSystem | Path.Path
> {
  const documents = yield* readManagedMemoryDocuments(vaultPath).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({
          reason: "InvalidVaultStructure",
          message: cause.message,
          cause,
        }),
    ),
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

export const inspectSemanticIndex = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  SemanticIndexInspection,
  SemanticIndexError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* indexPaths(vaultPath);
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
  if (!exists) return { status: "missing", vaultPath };
  const snapshot = yield* readSemanticIndexSnapshot(paths.databasePath).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({ reason: "IndexReadFailed", message: cause.message, cause }),
    ),
  );
  const metadata = snapshot.metadata;
  if (
    metadata === undefined ||
    metadata.schemaVersion !== INDEX_SCHEMA_VERSION ||
    metadata.compatibilityFingerprint !== SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT
  ) {
    return { status: "incompatible", vaultPath };
  }
  return { status: metadata.state, vaultPath };
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
  const documents = yield* loadInventory(vaultPath);
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
  yield* initializeSemanticIndexRepository(paths.databasePath, EMBEDDING_MODEL_DIMENSIONS).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({ reason: "IndexWriteFailed", message: cause.message, cause }),
    ),
  );
  yield* markSemanticIndexIncomplete(
    paths.databasePath,
    SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SemanticIndexError({ reason: "IndexWriteFailed", message: cause.message, cause }),
    ),
  );
  let embeddedChunks = 0;
  for (const document of documents) {
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
    inventoryFingerprint(documents),
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
    files: { new: documents.length, changed: 0, deleted: 0, unchanged: 0 },
    chunks: { embedded: embeddedChunks, removed: 0 },
    warnings: [],
  };
});

export const deleteSemanticIndex = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<SemanticIndexResult, SemanticIndexError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* indexPaths(vaultPath);
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
    };
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
  };
});
