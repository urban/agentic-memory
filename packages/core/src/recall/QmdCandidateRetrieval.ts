import { Effect, type FileSystem, type Path } from "effect";

import {
  classifyRecallLayer,
  isManagedRecallPath,
  readRecallDocuments,
} from "./RecallDocuments.ts";
import type { RecallError } from "./RecallContract.ts";
import type { RecallDocument, RecallLayer } from "./RecallModel.ts";

const defaultIgnorePatterns = [
  ".agentic-memory/**",
  ".agentic-memory-link/**",
  ".git/**",
  ".obsidian/**",
  ".cache/**",
  ".qmd/**",
  "AGENTS.md",
] satisfies ReadonlyArray<string>;

export type QmdLikeCandidateResult = {
  readonly displayPath: string;
  readonly collectionName: string;
  readonly docid?: string;
  readonly score?: number;
  readonly filepath?: string;
  readonly body?: string;
};

export type QmdRecallCandidateReference = {
  readonly path: string;
  readonly memoryLayer: RecallLayer;
};

export type QmdRecallCollectionConfig = {
  readonly collections: {
    readonly memory: {
      readonly path: string;
      readonly pattern: "**/*.md";
      readonly ignore: ReadonlyArray<string>;
      readonly includeByDefault: true;
      readonly context: Readonly<Record<string, string>>;
    };
  };
};

export type QmdRecallStoreOptions = {
  readonly dbPath: string;
  readonly config: QmdRecallCollectionConfig;
};

const normalizedVaultPath = (vaultPath: string): string =>
  vaultPath.replaceAll("\\", "/").replace(/\/+$/u, "");

const stableVaultId = (vaultPath: string): string => {
  const hash = Array.from(normalizedVaultPath(vaultPath)).reduce(
    (current, character) => Math.imul(current ^ (character.codePointAt(0) ?? 0), 16_777_619),
    2_166_136_261,
  );
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const joinCachePath = (cacheRoot: string, suffix: string): string =>
  `${cacheRoot.replace(/[\\/]+$/u, "")}/${suffix}`;

export const makeQmdRecallStoreOptions = (input: {
  readonly vaultPath: string;
  readonly cacheRoot: string;
  readonly includeSources: boolean;
}): QmdRecallStoreOptions => ({
  dbPath: joinCachePath(
    input.cacheRoot,
    `agentic-memory/qmd/${stableVaultId(input.vaultPath)}/index.sqlite`,
  ),
  config: {
    collections: {
      memory: {
        path: input.vaultPath,
        pattern: "**/*.md",
        ignore: input.includeSources
          ? defaultIgnorePatterns
          : [...defaultIgnorePatterns, "sources/**"],
        includeByDefault: true,
        context: {
          "/": "Curated Agentic Memory vault content",
          "/maps": "Routing and domain framing memory maps",
          "/notes": "Atomic reusable memory",
          "/people": "Durable people context",
          "/projects": "Project state, decisions, resume context, and routing",
          "/records": "Compact dated recall summaries",
          "/sources": "Raw source evidence; prefer curated memory first",
        },
      },
    },
  },
});

const relativePathFromResult = (result: QmdLikeCandidateResult): string => {
  const normalizedDisplayPath = result.displayPath.replaceAll("\\", "/");
  const collectionPrefix = `${result.collectionName}/`;
  return normalizedDisplayPath.startsWith(collectionPrefix)
    ? normalizedDisplayPath.slice(collectionPrefix.length)
    : normalizedDisplayPath;
};

export const normalizeQmdCandidateResults = (
  results: ReadonlyArray<QmdLikeCandidateResult>,
  includeSources: boolean,
): ReadonlyArray<QmdRecallCandidateReference> =>
  Array.from(
    results.reduce((references, result) => {
      const relativePath = relativePathFromResult(result);
      const memoryLayer = classifyRecallLayer(relativePath);
      if (
        memoryLayer === undefined ||
        !isManagedRecallPath(relativePath, includeSources) ||
        references.has(relativePath)
      ) {
        return references;
      }
      return new Map(references).set(relativePath, {
        path: relativePath,
        memoryLayer,
      });
    }, new Map<string, QmdRecallCandidateReference>()),
  ).map(([, reference]) => reference);

export const readDocumentsForQmdCandidates = (input: {
  readonly vaultPath: string;
  readonly includeSources: boolean;
  readonly results: ReadonlyArray<QmdLikeCandidateResult>;
}): Effect.Effect<
  ReadonlyArray<RecallDocument>,
  RecallError,
  FileSystem.FileSystem | Path.Path
> => {
  const selectedPaths = new Set(
    normalizeQmdCandidateResults(input.results, input.includeSources).map(
      (candidate) => candidate.path,
    ),
  );
  // Re-read managed files so snippets, scores, identifiers, and provider ordering cannot
  // become answer policy. readRecallDocuments supplies deterministic path ordering.
  return readRecallDocuments(input.vaultPath, input.includeSources).pipe(
    Effect.map((documents) => documents.filter((document) => selectedPaths.has(document.path))),
  );
};
