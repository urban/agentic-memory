import { createClient, LibsqlError } from "@libsql/client";
import { Effect, Path, Schema } from "effect";

type Client = import("@libsql/client").Client;
type InStatement = import("@libsql/client").InStatement;
type ManagedMemoryLayer = import("../vault/ManagedMemory.ts").ManagedMemoryLayer;

export const INDEX_SCHEMA_VERSION = 1;

export class SemanticIndexRepositoryError extends Schema.TaggedError<SemanticIndexRepositoryError>()(
  "SemanticIndexRepositoryError",
  {
    reason: Schema.Literals(["OpenFailed", "ReadFailed", "WriteFailed", "InvalidData"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type StoredIndexMetadata = {
  readonly schemaVersion: number;
  readonly compatibilityFingerprint: string;
  readonly inventoryFingerprint: string;
  readonly state: "complete" | "incomplete";
};

export type StoredIndexDocument = {
  readonly path: string;
  readonly contentHash: string;
  readonly chunkCount: number;
  readonly integrity: "complete" | "incomplete" | "chunk_count_mismatch";
};

export type StoredIndexSnapshot = {
  readonly metadata: StoredIndexMetadata | undefined;
  readonly documents: ReadonlyArray<StoredIndexDocument>;
};

export type IndexedDocumentWrite = {
  readonly path: string;
  readonly contentHash: string;
  readonly memoryLayer: ManagedMemoryLayer;
  readonly contentStatus: string | undefined;
  readonly projectStatus: string | undefined;
  readonly title: string;
  readonly chunks: ReadonlyArray<{
    readonly id: string;
    readonly ordinal: number;
    readonly headingPath: ReadonlyArray<string>;
    readonly startLine: number;
    readonly endLine: number;
    readonly text: string;
    readonly textHash: string;
    readonly embedding: ReadonlyArray<number>;
  }>;
};

const MetadataRow = Schema.Struct({
  schema_version: Schema.Int,
  compatibility_fingerprint: Schema.String,
  inventory_fingerprint: Schema.String,
  state: Schema.Literals(["complete", "incomplete"]),
}).annotate({ identifier: "SemanticIndexMetadataRow" });
const DocumentRow = Schema.Struct({
  path: Schema.String,
  content_hash: Schema.String,
  chunk_count: Schema.Int,
  complete: Schema.Literals([0, 1]),
  actual_chunk_count: Schema.Int,
}).annotate({ identifier: "SemanticIndexDocumentRow" });
const SearchRow = Schema.Struct({
  document_path: Schema.String,
  ordinal: Schema.Int,
  text: Schema.String,
  text_hash: Schema.String,
  distance: Schema.Finite,
}).annotate({ identifier: "SemanticIndexSearchRow" });

const decodeMetadataRow = Schema.decodeUnknownEffect(MetadataRow);
const decodeDocumentRow = Schema.decodeUnknownEffect(DocumentRow);
const decodeSearchRow = Schema.decodeUnknownEffect(SearchRow);

const invalidSchemaCodes = new Set(["SQLITE_ERROR", "SQLITE_SCHEMA"]);

const readFailureReason = (cause: unknown): "ReadFailed" | "InvalidData" =>
  cause instanceof LibsqlError && invalidSchemaCodes.has(cause.extendedCode ?? cause.code)
    ? "InvalidData"
    : "ReadFailed";

const repositoryOperation = <A>(
  reason: "OpenFailed" | "ReadFailed" | "WriteFailed",
  message: string,
  operation: () => Promise<A>,
): Effect.Effect<A, SemanticIndexRepositoryError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => SemanticIndexRepositoryError.make({ reason, message, cause }),
  });

const repositoryReadOperation = <A>(
  message: string,
  operation: () => Promise<A>,
): Effect.Effect<A, SemanticIndexRepositoryError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      SemanticIndexRepositoryError.make({ reason: readFailureReason(cause), message, cause }),
  });

const acquireClient = Effect.fnUntraced(function* (databasePath: string) {
  const path = yield* Path.Path;
  const databaseUrl = yield* path.toFileUrl(databasePath).pipe(
    Effect.mapError((cause) =>
      SemanticIndexRepositoryError.make({
        reason: "OpenFailed",
        message: "Failed to encode the semantic index database path",
        cause,
      }),
    ),
  );
  return yield* Effect.acquireRelease(
    Effect.try({
      try: () => createClient({ url: databaseUrl.href, intMode: "number" }),
      catch: (cause) =>
        SemanticIndexRepositoryError.make({
          reason: "OpenFailed",
          message: "Failed to open the semantic index database",
          cause,
        }),
    }),
    (client) =>
      Effect.sync(() => {
        client.close();
      }),
  );
});

const withClient = <A, E>(
  databasePath: string,
  use: (client: Client) => Effect.Effect<A, E>,
): Effect.Effect<A, E | SemanticIndexRepositoryError, Path.Path> =>
  Effect.scoped(acquireClient(databasePath).pipe(Effect.flatMap(use)));

const readStoredDocuments = Effect.fnUntraced(function* (
  client: Client,
): Effect.fn.Return<ReadonlyArray<StoredIndexDocument>, SemanticIndexRepositoryError> {
  const result = yield* repositoryReadOperation("Failed to read semantic index documents", () =>
    client.execute(`SELECT path, content_hash, chunk_count, complete,
        (SELECT COUNT(*) FROM chunks WHERE chunks.document_path = documents.path)
          AS actual_chunk_count
        FROM documents ORDER BY path`),
  );
  const documents = yield* Effect.forEach(result.rows, (row) =>
    decodeDocumentRow(row).pipe(
      Effect.mapError((cause) =>
        SemanticIndexRepositoryError.make({
          reason: "InvalidData",
          message: "Semantic index document metadata is invalid",
          cause,
        }),
      ),
    ),
  );
  return documents.map((document) => ({
    path: document.path,
    contentHash: document.content_hash,
    chunkCount: document.chunk_count,
    integrity:
      document.complete === 0
        ? "incomplete"
        : document.chunk_count === document.actual_chunk_count
          ? "complete"
          : "chunk_count_mismatch",
  }));
});

export const initializeSemanticIndexRepository = (
  databasePath: string,
  dimensions: number,
): Effect.Effect<void, SemanticIndexRepositoryError, Path.Path> =>
  withClient(databasePath, (client) =>
    repositoryOperation("WriteFailed", "Failed to initialize the semantic index schema", () =>
      client.executeMultiple(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS index_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          compatibility_fingerprint TEXT NOT NULL,
          inventory_fingerprint TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('complete', 'incomplete')),
          completed_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS documents (
          path TEXT PRIMARY KEY,
          content_hash TEXT NOT NULL,
          memory_layer TEXT NOT NULL,
          content_status TEXT NOT NULL,
          project_status TEXT NOT NULL,
          title TEXT NOT NULL,
          chunk_count INTEGER NOT NULL,
          complete INTEGER NOT NULL CHECK (complete IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          document_path TEXT NOT NULL REFERENCES documents(path) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          heading_path TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          text TEXT NOT NULL,
          text_hash TEXT NOT NULL,
          embedding F32_BLOB(${dimensions}) NOT NULL,
          UNIQUE(document_path, ordinal)
        );
      `),
    ),
  );

export const readSemanticIndexSnapshot = (
  databasePath: string,
): Effect.Effect<StoredIndexSnapshot, SemanticIndexRepositoryError, Path.Path> =>
  withClient(databasePath, (client) =>
    Effect.gen(function* () {
      const metadataResult = yield* repositoryReadOperation(
        "Failed to read semantic index metadata",
        () => client.execute("SELECT * FROM index_metadata WHERE id = 1"),
      );
      const metadataRow = metadataResult.rows[0];
      const metadata =
        metadataRow === undefined
          ? undefined
          : yield* decodeMetadataRow(metadataRow).pipe(
              Effect.mapError((cause) =>
                SemanticIndexRepositoryError.make({
                  reason: "InvalidData",
                  message: "Semantic index metadata is invalid",
                  cause,
                }),
              ),
            );
      const documents = yield* readStoredDocuments(client);
      return {
        metadata:
          metadata === undefined
            ? undefined
            : {
                schemaVersion: metadata.schema_version,
                compatibilityFingerprint: metadata.compatibility_fingerprint,
                inventoryFingerprint: metadata.inventory_fingerprint,
                state: metadata.state,
              },
        documents,
      };
    }),
  );

export const readSemanticIndexDocuments = (
  databasePath: string,
): Effect.Effect<ReadonlyArray<StoredIndexDocument>, SemanticIndexRepositoryError, Path.Path> =>
  withClient(databasePath, readStoredDocuments);

export const markSemanticIndexIncomplete = (
  databasePath: string,
  compatibilityFingerprint: string,
): Effect.Effect<void, SemanticIndexRepositoryError, Path.Path> =>
  withClient(databasePath, (client) =>
    repositoryOperation("WriteFailed", "Failed to mark the semantic index incomplete", () =>
      client.execute({
        sql: `INSERT INTO index_metadata
          (id, schema_version, compatibility_fingerprint, inventory_fingerprint, state, completed_at_ms)
          VALUES (1, ?, ?, '', 'incomplete', 0)
          ON CONFLICT(id) DO UPDATE SET state = 'incomplete', inventory_fingerprint = ''`,
        args: [INDEX_SCHEMA_VERSION, compatibilityFingerprint],
      }),
    ).pipe(Effect.asVoid),
  );

export const replaceSemanticIndexDocument = (
  databasePath: string,
  document: IndexedDocumentWrite,
): Effect.Effect<void, SemanticIndexRepositoryError, Path.Path> =>
  withClient(databasePath, (client) => {
    const statements: Array<InStatement> = [
      { sql: "DELETE FROM chunks WHERE document_path = ?", args: [document.path] },
      { sql: "DELETE FROM documents WHERE path = ?", args: [document.path] },
      {
        sql: `INSERT INTO documents
          (path, content_hash, memory_layer, content_status, project_status, title, chunk_count, complete)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          document.path,
          document.contentHash,
          document.memoryLayer,
          document.contentStatus ?? "",
          document.projectStatus ?? "",
          document.title,
          document.chunks.length,
        ],
      },
      ...document.chunks.map((chunk): InStatement => ({
        sql: `INSERT INTO chunks
            (id, document_path, ordinal, heading_path, start_line, end_line, text, text_hash, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, vector32(?))`,
        args: [
          chunk.id,
          document.path,
          chunk.ordinal,
          chunk.headingPath.join("\n"),
          chunk.startLine,
          chunk.endLine,
          chunk.text,
          chunk.textHash,
          `[${chunk.embedding.join(",")}]`,
        ],
      })),
    ];
    return repositoryOperation(
      "WriteFailed",
      `Failed to atomically replace semantic index document: ${document.path}`,
      () => client.batch(statements, "write"),
    ).pipe(Effect.asVoid);
  });

export const removeSemanticIndexDocuments = (
  databasePath: string,
  documentPaths: ReadonlyArray<string>,
): Effect.Effect<void, SemanticIndexRepositoryError, Path.Path> =>
  documentPaths.length === 0
    ? Effect.void
    : withClient(databasePath, (client) =>
        repositoryOperation(
          "WriteFailed",
          "Failed to remove deleted semantic index documents",
          () =>
            client.batch(
              documentPaths.map((documentPath): InStatement => ({
                sql: "DELETE FROM documents WHERE path = ?",
                args: [documentPath],
              })),
              "write",
            ),
        ).pipe(Effect.asVoid),
      );

export const completeSemanticIndex = (
  databasePath: string,
  compatibilityFingerprint: string,
  inventoryFingerprint: string,
  completedAtMs: number,
): Effect.Effect<void, SemanticIndexRepositoryError, Path.Path> =>
  withClient(databasePath, (client) =>
    repositoryOperation("WriteFailed", "Failed to complete the semantic index snapshot", () =>
      client.execute({
        sql: `UPDATE index_metadata SET
          schema_version = ?, compatibility_fingerprint = ?, inventory_fingerprint = ?,
          state = 'complete', completed_at_ms = ? WHERE id = 1`,
        args: [INDEX_SCHEMA_VERSION, compatibilityFingerprint, inventoryFingerprint, completedAtMs],
      }),
    ).pipe(Effect.asVoid),
  );

export const searchSemanticIndexExact = (
  databasePath: string,
  query: ReadonlyArray<number>,
  limit: number,
  eligibility: "all" | "exclude_sources",
): Effect.Effect<
  ReadonlyArray<{
    readonly documentPath: string;
    readonly ordinal: number;
    readonly text: string;
    readonly textHash: string;
    readonly distance: number;
  }>,
  SemanticIndexRepositoryError,
  Path.Path
> =>
  withClient(databasePath, (client) =>
    Effect.gen(function* () {
      const result = yield* repositoryReadOperation(
        "Failed to execute exact cosine semantic index search",
        () =>
          client.execute({
            sql: `SELECT document_path, ordinal, text, text_hash,
              vector_distance_cos(embedding, vector32(?)) AS distance
              FROM chunks
              ${eligibility === "exclude_sources" ? "WHERE document_path NOT LIKE 'sources/%'" : ""}
              ORDER BY distance, document_path, ordinal LIMIT ?`,
            args: [`[${query.join(",")}]`, limit],
          }),
      );
      const rows = yield* Effect.forEach(result.rows, (row) =>
        decodeSearchRow(row).pipe(
          Effect.mapError((cause) =>
            SemanticIndexRepositoryError.make({
              reason: "InvalidData",
              message: "Semantic index search result is invalid",
              cause,
            }),
          ),
        ),
      );
      return rows.map((row) => ({
        documentPath: row.document_path,
        ordinal: row.ordinal,
        text: row.text,
        textHash: row.text_hash,
        distance: row.distance,
      }));
    }),
  );
