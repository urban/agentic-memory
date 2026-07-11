import { Effect, FileSystem, Path } from "effect";

import { RecallError } from "./RecallContract.ts";
import type {
  ParsedRecallDocument,
  RecallContentStatus,
  RecallDocument,
  RecallLayer,
  RecallProjectStatus,
} from "./RecallModel.ts";
import { cleanMarkup, lastPathSegment, tokenize, uniqueStrings } from "./RecallText.ts";

const managedPrefixes = [
  ["maps/", "map"],
  ["projects/", "project"],
  ["notes/", "note"],
  ["people/", "person"],
  ["records/", "record"],
  ["sources/", "source"],
] satisfies ReadonlyArray<readonly [string, RecallLayer]>;

export const classifyRecallLayer = (relativePath: string): RecallLayer | undefined => {
  if (relativePath === "MEMORY.md") {
    return "core";
  }
  if (relativePath === "USER.md") {
    return "user";
  }
  return managedPrefixes.find(([prefix]) => relativePath.startsWith(prefix))?.[1];
};

const isVaultRelativeMarkdownPath = (relativePath: string): boolean => {
  const segments = relativePath.split("/");

  return (
    relativePath.endsWith(".md") &&
    !relativePath.startsWith("/") &&
    !relativePath.startsWith(".") &&
    !relativePath.includes("\\") &&
    !segments.includes("..") &&
    segments.every((segment) => segment.length > 0)
  );
};

export const isManagedRecallPath = (relativePath: string, includeSources: boolean): boolean =>
  isVaultRelativeMarkdownPath(relativePath) &&
  classifyRecallLayer(relativePath) !== undefined &&
  (includeSources || !relativePath.startsWith("sources/"));

const normalizeRelativePath = (entry: string, path: Path.Path): string =>
  path.sep === "/" ? entry : entry.replaceAll(path.sep, "/");

const splitFrontmatter = (
  content: string,
): { readonly frontmatter: string | undefined; readonly body: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (match === null) {
    return { frontmatter: undefined, body: content };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
};

const unquoteFrontmatterValue = (value: string): string => {
  const trimmed = value.trim();
  const firstCharacter = trimmed[0];
  const lastCharacter = trimmed[trimmed.length - 1];
  return (firstCharacter === `"` || firstCharacter === "'") && firstCharacter === lastCharacter
    ? trimmed.slice(1, -1)
    : trimmed;
};

const extractFrontmatterStringField = (
  frontmatter: string | undefined,
  fieldName: string,
): string | undefined => {
  if (frontmatter === undefined) {
    return undefined;
  }

  const prefix = `${fieldName}:`;
  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith(prefix)) {
      const value = line.slice(prefix.length).trim();
      return value.length === 0 ? undefined : cleanMarkup(unquoteFrontmatterValue(value));
    }
  }

  return undefined;
};

const extractFrontmatterStringListField = (
  frontmatter: string | undefined,
  fieldName: string,
): ReadonlyArray<string> => {
  if (frontmatter === undefined) {
    return [];
  }

  const values: Array<string> = [];
  let insideField = false;

  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    const topLevelMatch = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (topLevelMatch !== null) {
      const key = topLevelMatch[1] ?? "";
      const value = topLevelMatch[2] ?? "";
      insideField = key === fieldName;
      if (insideField) {
        const trimmedValue = value.trim();
        if (trimmedValue.length > 0 && trimmedValue !== "[]") {
          values.push(cleanMarkup(unquoteFrontmatterValue(trimmedValue)));
        }
      }
      continue;
    }

    if (insideField) {
      const itemMatch = rawLine.match(/^\s*-\s*(.+)$/u);
      const item = itemMatch?.[1];
      if (item !== undefined) {
        values.push(cleanMarkup(unquoteFrontmatterValue(item)));
      }
    }
  }

  return uniqueStrings(values);
};

const parseDeclaredType = (value: string | undefined): RecallLayer | undefined => {
  const normalized = value?.toLowerCase();
  switch (normalized) {
    case "core":
    case "user":
    case "map":
    case "project":
    case "note":
    case "person":
    case "record":
    case "source":
      return normalized;
    default:
      return undefined;
  }
};

const parseContentStatus = (value: string | undefined): RecallContentStatus | undefined => {
  const normalized = value?.toLowerCase();
  switch (normalized) {
    case "draft":
    case "active":
    case "stale":
    case "archived":
      return normalized;
    default:
      return undefined;
  }
};

const parseProjectStatus = (value: string | undefined): RecallProjectStatus | undefined => {
  const normalized = value?.toLowerCase();
  switch (normalized) {
    case "candidate":
    case "active":
    case "completed":
    case "archived":
      return normalized;
    default:
      return undefined;
  }
};

const extractFirstHeading = (body: string): string | undefined => {
  for (const rawLine of body.split(/\r?\n/u)) {
    const match = rawLine.match(/^#\s+(.+)$/u);
    const heading = match?.[1];
    if (heading !== undefined) {
      return cleanMarkup(heading);
    }
  }
  return undefined;
};

export const titleFromPath = (relativePath: string): string => {
  const filename = lastPathSegment(relativePath).replace(/\.md$/u, "");
  return filename.replace(/[-_]+/gu, " ");
};

export const parseRecallDocument = (document: RecallDocument): ParsedRecallDocument => {
  const { frontmatter, body } = splitFrontmatter(document.content);
  const declaredType = parseDeclaredType(extractFrontmatterStringField(frontmatter, "type"));
  const status = parseContentStatus(extractFrontmatterStringField(frontmatter, "status"));
  const projectStatus = parseProjectStatus(
    extractFrontmatterStringField(frontmatter, "project_status"),
  );
  const summary = extractFrontmatterStringField(frontmatter, "summary");
  const aliases = extractFrontmatterStringListField(frontmatter, "aliases");
  const title = extractFirstHeading(body) ?? titleFromPath(document.path);
  const metadataText = [
    document.path,
    title,
    declaredType ?? "",
    status ?? "",
    projectStatus ?? "",
    summary ?? "",
    ...aliases,
  ].join(" ");

  return {
    ...document,
    aliases,
    body,
    declaredType,
    metadataTokens: tokenize(metadataText),
    projectStatus,
    status,
    summary,
    title,
  };
};

export const readRecallDocuments = Effect.fnUntraced(function* (
  vaultPath: string,
  includeSources: boolean,
): Effect.fn.Return<ReadonlyArray<RecallDocument>, RecallError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectory(vaultPath, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new RecallError({
          reason: "ReadVaultFailed",
          message: `Failed to read vault contents: ${vaultPath}`,
          cause,
        }),
    ),
  );
  const relativePaths = entries
    .map((entry) => normalizeRelativePath(entry, path))
    .filter((relativePath) => isManagedRecallPath(relativePath, includeSources))
    .toSorted();

  return yield* Effect.forEach(relativePaths, (relativePath) =>
    Effect.gen(function* () {
      const memoryLayer = classifyRecallLayer(relativePath);
      if (memoryLayer === undefined) {
        return [] satisfies ReadonlyArray<RecallDocument>;
      }

      const content = yield* fs.readFileString(path.join(vaultPath, relativePath)).pipe(
        Effect.mapError(
          (cause) =>
            new RecallError({
              reason: "ReadVaultFailed",
              message: `Failed to read recall candidate: ${relativePath}`,
              cause,
            }),
        ),
      );

      return [
        {
          path: relativePath,
          memoryLayer,
          content,
        },
      ] satisfies ReadonlyArray<RecallDocument>;
    }),
  ).pipe(Effect.map((documents) => documents.flatMap((document) => document)));
});
