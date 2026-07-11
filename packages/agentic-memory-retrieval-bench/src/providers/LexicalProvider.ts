import { Effect, FileSystem, Path, PlatformError } from "effect";
import {
  classifyMemoryLayer,
  isManagedMemoryPath,
  type MemoryLayer,
  type RetrievalProvider,
  type RetrievalRequest,
  type RetrievalResult,
} from "../RetrievalProvider.ts";

type MemoryDocument = {
  readonly path: string;
  readonly memoryLayer: MemoryLayer;
  readonly content: string;
};

const stopWords = new Set([
  "and",
  "back",
  "for",
  "how",
  "into",
  "need",
  "should",
  "the",
  "what",
  "when",
  "with",
]);

const normalizeToken = (token: string): string => {
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
};

const tokenize = (input: string): ReadonlyArray<string> =>
  input
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !stopWords.has(token));

const normalizeRelativePath = (entry: string, path: Path.Path): string =>
  path.sep === "/" ? entry : entry.replaceAll(path.sep, "/");

const isIndexablePath = (relativePath: string, includeSources: boolean): boolean =>
  isManagedMemoryPath(relativePath) && (includeSources || !relativePath.startsWith("sources/"));

const readDocuments = (
  request: RetrievalRequest,
): Effect.Effect<
  ReadonlyArray<MemoryDocument>,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(request.vaultPath, { recursive: true });
    const relativePaths = entries
      .map((entry) => normalizeRelativePath(entry, path))
      .filter((relativePath) => isIndexablePath(relativePath, request.includeSources))
      .toSorted();

    return yield* Effect.forEach(relativePaths, (relativePath) =>
      Effect.gen(function* () {
        const memoryLayer = classifyMemoryLayer(relativePath);
        const content = yield* fs.readFileString(path.join(request.vaultPath, relativePath));

        return memoryLayer === undefined ? [] : [{ path: relativePath, memoryLayer, content }];
      }),
    ).pipe(Effect.map((documents) => documents.flatMap((document) => document)));
  });

const countTokenMatches = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
): number => {
  const candidateTokenCounts = candidateTokens.reduce(
    (counts, token) => counts.set(token, (counts.get(token) ?? 0) + 1),
    new Map<string, number>(),
  );

  return queryTokens.reduce(
    (score, token) => score + Math.min(candidateTokenCounts.get(token) ?? 0, 3),
    0,
  );
};

const countUniqueTokenMatches = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
): number => {
  const candidateTokenSet = new Set(candidateTokens);
  return queryTokens.filter((token) => candidateTokenSet.has(token)).length;
};

const hasUserPreferenceIntent = (queryTokens: ReadonlyArray<string>): boolean => {
  const userPreferenceSignals = new Set(["option", "present", "prioritization", "urban", "user"]);
  return queryTokens.some((token) => userPreferenceSignals.has(token));
};

const projectSlugScore = (document: MemoryDocument, projectSlug: string | undefined): number => {
  if (projectSlug === undefined) {
    return 0;
  }

  if (document.path === `projects/${projectSlug}.md`) {
    return 100;
  }

  const projectSlugTokens = tokenize(projectSlug);
  const pathTokens = tokenize(document.path);
  const contentTokens = tokenize(document.content);
  const pathMatches = countUniqueTokenMatches(projectSlugTokens, pathTokens);
  const contentMatches = countUniqueTokenMatches(projectSlugTokens, contentTokens);

  return pathMatches * 12 + contentMatches * 3;
};

const userPreferenceScore = (
  document: MemoryDocument,
  queryTokens: ReadonlyArray<string>,
): number => {
  if (!hasUserPreferenceIntent(queryTokens)) {
    return 0;
  }

  if (document.path === "USER.md") {
    return 90;
  }

  return document.path === "notes/user-option-format.md" ? 35 : 0;
};

const layerRouteScore = (document: MemoryDocument): number => {
  switch (document.memoryLayer) {
    case "project":
      return 8;
    case "map":
      return 5;
    case "note":
      return 3;
    case "core":
    case "user":
      return 2;
    case "person":
    case "record":
    case "source":
      return 0;
  }
};

const scoreDocument = (request: RetrievalRequest, document: MemoryDocument): number => {
  const queryTokens = tokenize(request.query);
  const contentTokens = tokenize(document.content);
  const pathTokens = tokenize(document.path);
  const tokenFrequencyScore = countTokenMatches(queryTokens, contentTokens);
  const uniqueContentScore = countUniqueTokenMatches(queryTokens, contentTokens) * 4;
  const uniquePathScore = countUniqueTokenMatches(queryTokens, pathTokens) * 6;

  return (
    tokenFrequencyScore +
    uniqueContentScore +
    uniquePathScore +
    projectSlugScore(document, request.projectSlug) +
    userPreferenceScore(document, queryTokens) +
    layerRouteScore(document)
  );
};

const snippetForDocument = (query: string, content: string): string => {
  const queryTokens = tokenize(query);
  const matchingLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => {
      const lineTokens = tokenize(line);
      return queryTokens.some((token) => lineTokens.includes(token));
    });

  return matchingLine ?? content.slice(0, 200).trim();
};

const toResult = (request: RetrievalRequest, document: MemoryDocument): RetrievalResult => ({
  path: document.path,
  memoryLayer: document.memoryLayer,
  score: scoreDocument(request, document),
  snippet: snippetForDocument(request.query, document.content),
});

export const makeLexicalProvider = (): RetrievalProvider => ({
  name: "lexical-baseline",
  retrieve: (request) =>
    readDocuments(request).pipe(
      Effect.map((documents) =>
        documents
          .map((document) => toResult(request, document))
          .filter((result) => result.score > 0)
          .toSorted(
            (left, right) => right.score - left.score || left.path.localeCompare(right.path),
          )
          .slice(0, request.limit),
      ),
    ),
});
