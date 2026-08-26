import { Effect, FileSystem, Path, Schema } from "effect";
import { chunkManagedMemoryDocument } from "../semantic/MarkdownChunking.ts";
import { parseManagedMemoryDocument, readManagedMemoryDocuments } from "../vault/ManagedMemory.ts";
type SemanticRecallCandidate = import("../semantic/SemanticIndex.ts").SemanticRecallCandidate;

export class EvidenceHydrationError extends Schema.TaggedError<EvidenceHydrationError>()(
  "EvidenceHydrationError",
  {
    reason: Schema.Literals([
      "ReadFailed",
      "DocumentMissing",
      "OrdinalMissing",
      "ProvenanceMismatch",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const hydrateSemanticRecallCandidate = Effect.fnUntraced(function* (
  vaultPath: string,
  candidate: SemanticRecallCandidate,
): Effect.fn.Return<string, EvidenceHydrationError, FileSystem.FileSystem | Path.Path> {
  const documents = yield* readManagedMemoryDocuments(
    vaultPath,
    ({ path }) => path === candidate.documentPath,
  ).pipe(
    Effect.mapError((cause) =>
      EvidenceHydrationError.make({
        reason: "ReadFailed",
        message: "Failed to hydrate current Agentic Memory evidence",
        cause,
      }),
    ),
  );
  const document = documents[0];
  if (document === undefined) {
    return yield* EvidenceHydrationError.make({
      reason: "DocumentMissing",
      message: "The selected semantic evidence document is no longer available",
    });
  }
  const chunk = chunkManagedMemoryDocument(parseManagedMemoryDocument(document)).find(
    ({ ordinal }) => ordinal === candidate.ordinal,
  );
  if (chunk === undefined) {
    return yield* EvidenceHydrationError.make({
      reason: "OrdinalMissing",
      message: "The selected semantic evidence ordinal is missing from current Markdown",
    });
  }
  if (chunk.textHash !== candidate.textHash) {
    return yield* EvidenceHydrationError.make({
      reason: "ProvenanceMismatch",
      message: "The selected semantic evidence provenance no longer matches current Markdown",
    });
  }
  return chunk.text;
});
