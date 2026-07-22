import { Effect, FileSystem, Path } from "effect";
import {
  classifyManagedMemoryLayer,
  classifyManagedMemoryPath,
  parseManagedMemoryDocument,
  readManagedMemoryDocuments,
  titleFromManagedPath,
} from "../vault/ManagedMemory.ts";
import { RecallError } from "./RecallContract.ts";
import { tokenize } from "./RecallText.ts";

type ParsedRecallDocument = import("./RecallModel.ts").ParsedRecallDocument;
type RecallDocument = import("./RecallModel.ts").RecallDocument;

export const classifyRecallLayer = classifyManagedMemoryLayer;
export const isManagedRecallPath = (relativePath: string, includeSources: boolean): boolean => {
  const candidate = classifyManagedMemoryPath(relativePath);
  return candidate !== undefined && (includeSources || candidate.memoryLayer !== "source");
};
export const titleFromPath = titleFromManagedPath;

export const parseRecallDocument = (document: RecallDocument): ParsedRecallDocument => {
  const parsed = parseManagedMemoryDocument({
    ...document,
    contentHash: "",
  });
  const metadataText = [
    document.path,
    parsed.title,
    parsed.declaredType ?? "",
    parsed.status ?? "",
    parsed.projectStatus ?? "",
    parsed.summary ?? "",
    ...parsed.aliases,
  ].join(" ");
  return {
    ...document,
    aliases: parsed.aliases,
    body: parsed.body,
    declaredType: parsed.declaredType,
    metadataTokens: tokenize(metadataText),
    projectStatus: parsed.projectStatus,
    status: parsed.status,
    summary: parsed.summary,
    title: parsed.title,
  };
};

export const readRecallDocuments = Effect.fnUntraced(function* (
  vaultPath: string,
  includeSources: boolean,
): Effect.fn.Return<ReadonlyArray<RecallDocument>, RecallError, FileSystem.FileSystem | Path.Path> {
  const documents = yield* readManagedMemoryDocuments(
    vaultPath,
    ({ memoryLayer }) => includeSources || memoryLayer !== "source",
  ).pipe(
    Effect.mapError(
      (cause) =>
        new RecallError({
          reason: "ReadVaultFailed",
          message: cause.message,
          cause,
        }),
    ),
  );
  return documents.map(({ path, memoryLayer, content }) => ({ path, memoryLayer, content }));
});
