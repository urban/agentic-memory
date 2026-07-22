import { createHash } from "node:crypto";
import { Effect, FileSystem, Path, Schema } from "effect";

export type ManagedMemoryLayer =
  | "core"
  | "user"
  | "map"
  | "project"
  | "note"
  | "person"
  | "record"
  | "source";

export type ManagedContentStatus = "draft" | "active" | "stale" | "archived";
export type ManagedProjectStatus = "candidate" | "active" | "completed" | "archived";

export interface ManagedMemoryDocument {
  readonly path: string;
  readonly memoryLayer: ManagedMemoryLayer;
  readonly content: string;
  readonly contentHash: string;
}

export interface ManagedMemoryPath {
  readonly path: string;
  readonly memoryLayer: ManagedMemoryLayer;
}

export type ManagedMemoryEligibility = (candidate: ManagedMemoryPath) => boolean;

export interface ParsedManagedMemoryDocument extends ManagedMemoryDocument {
  readonly body: string;
  readonly bodyStartLine: number;
  readonly title: string;
  readonly declaredType: ManagedMemoryLayer | undefined;
  readonly status: ManagedContentStatus | undefined;
  readonly projectStatus: ManagedProjectStatus | undefined;
  readonly summary: string | undefined;
  readonly aliases: ReadonlyArray<string>;
}

export class ManagedMemoryError extends Schema.TaggedErrorClass<ManagedMemoryError>()(
  "ManagedMemoryError",
  {
    reason: Schema.Literals(["InvalidVaultPath", "ReadVaultFailed", "UnsafeManagedPath"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const managedPrefixes = [
  ["maps/", "map"],
  ["projects/", "project"],
  ["notes/", "note"],
  ["people/", "person"],
  ["records/", "record"],
  ["sources/", "source"],
] satisfies ReadonlyArray<readonly [string, ManagedMemoryLayer]>;

export const classifyManagedMemoryLayer = (
  relativePath: string,
): ManagedMemoryLayer | undefined => {
  if (relativePath === "MEMORY.md") return "core";
  if (relativePath === "USER.md") return "user";
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

export const isManagedMemoryPath = (relativePath: string): boolean =>
  classifyManagedMemoryPath(relativePath) !== undefined;

export const classifyManagedMemoryPath = (relativePath: string): ManagedMemoryPath | undefined => {
  if (!isVaultRelativeMarkdownPath(relativePath)) return undefined;
  const memoryLayer = classifyManagedMemoryLayer(relativePath);
  return memoryLayer === undefined ? undefined : { path: relativePath, memoryLayer };
};

const normalizeRelativePath = (entry: string, path: Path.Path): string =>
  path.sep === "/" ? entry : entry.replaceAll(path.sep, "/");

export const hashManagedMemoryContent = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const cleanMetadataMarkup = (value: string): string =>
  value
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, "$2")
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/[*_`]/gu, "")
    .trim();

export const splitManagedFrontmatter = (
  content: string,
): {
  readonly frontmatter: string | undefined;
  readonly body: string;
  readonly bodyStartLine: number;
} => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (match === null) return { frontmatter: undefined, body: content, bodyStartLine: 1 };
  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
    bodyStartLine: match[0].split(/\r?\n/u).length,
  };
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === `"` || first === "'") && first === last ? trimmed.slice(1, -1) : trimmed;
};

const frontmatterString = (
  frontmatter: string | undefined,
  fieldName: string,
): string | undefined => {
  if (frontmatter === undefined) return undefined;
  const prefix = `${fieldName}:`;
  const line = frontmatter
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length).trim();
  return value === undefined || value.length === 0
    ? undefined
    : cleanMetadataMarkup(unquote(value));
};

const frontmatterStrings = (
  frontmatter: string | undefined,
  fieldName: string,
): ReadonlyArray<string> => {
  if (frontmatter === undefined) return [];
  const values: Array<string> = [];
  let insideField = false;
  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    const topLevel = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (topLevel !== null) {
      insideField = topLevel[1] === fieldName;
      const value = topLevel[2]?.trim();
      if (insideField && value !== undefined && value.length > 0 && value !== "[]") {
        values.push(cleanMetadataMarkup(unquote(value)));
      }
      continue;
    }
    const item = insideField ? rawLine.match(/^\s*-\s*(.+)$/u)?.[1] : undefined;
    if (item !== undefined) values.push(cleanMetadataMarkup(unquote(item)));
  }
  return [...new Set(values.filter((value) => value.length > 0))];
};

const managedLayer = (value: string | undefined): ManagedMemoryLayer | undefined => {
  const normalized = value?.toLowerCase();
  return normalized === "core" ||
    normalized === "user" ||
    normalized === "map" ||
    normalized === "project" ||
    normalized === "note" ||
    normalized === "person" ||
    normalized === "record" ||
    normalized === "source"
    ? normalized
    : undefined;
};

const contentStatus = (value: string | undefined): ManagedContentStatus | undefined => {
  const normalized = value?.toLowerCase();
  return normalized === "draft" ||
    normalized === "active" ||
    normalized === "stale" ||
    normalized === "archived"
    ? normalized
    : undefined;
};

const projectStatus = (value: string | undefined): ManagedProjectStatus | undefined => {
  const normalized = value?.toLowerCase();
  return normalized === "candidate" ||
    normalized === "active" ||
    normalized === "completed" ||
    normalized === "archived"
    ? normalized
    : undefined;
};

export const titleFromManagedPath = (relativePath: string): string => {
  const filename = relativePath.split("/").at(-1)?.replace(/\.md$/u, "") ?? relativePath;
  return filename.replace(/[-_]+/gu, " ");
};

export const parseManagedMemoryDocument = (
  document: ManagedMemoryDocument,
): ParsedManagedMemoryDocument => {
  const { frontmatter, body, bodyStartLine } = splitManagedFrontmatter(document.content);
  const firstHeading = body
    .split(/\r?\n/u)
    .map((line) => line.match(/^#\s+(.+)$/u)?.[1])
    .find((heading) => heading !== undefined);
  return {
    ...document,
    body,
    bodyStartLine,
    title:
      firstHeading === undefined
        ? titleFromManagedPath(document.path)
        : cleanMetadataMarkup(firstHeading),
    declaredType: managedLayer(frontmatterString(frontmatter, "type")),
    status: contentStatus(frontmatterString(frontmatter, "status")),
    projectStatus: projectStatus(frontmatterString(frontmatter, "project_status")),
    summary: frontmatterString(frontmatter, "summary"),
    aliases: frontmatterStrings(frontmatter, "aliases"),
  };
};

const isInsideVault = (
  vaultRealPath: string,
  candidateRealPath: string,
  path: Path.Path,
): boolean => {
  const relative = path.relative(vaultRealPath, candidateRealPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const readManagedMemoryDocuments = Effect.fnUntraced(function* (
  vaultPath: string,
  isEligible: ManagedMemoryEligibility = () => true,
): Effect.fn.Return<
  ReadonlyArray<ManagedMemoryDocument>,
  ManagedMemoryError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vaultRealPath = yield* fs.realPath(vaultPath).pipe(
    Effect.mapError(
      (cause) =>
        new ManagedMemoryError({
          reason: "ReadVaultFailed",
          message: `Failed to resolve vault path: ${vaultPath}`,
          cause,
        }),
    ),
  );
  const entries = yield* fs.readDirectory(vaultPath, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new ManagedMemoryError({
          reason: "ReadVaultFailed",
          message: `Failed to read vault contents: ${vaultPath}`,
          cause,
        }),
    ),
  );
  const candidates = entries
    .map((entry) => normalizeRelativePath(entry, path))
    .flatMap((relativePath) => {
      const candidate = classifyManagedMemoryPath(relativePath);
      return candidate === undefined ? [] : [candidate];
    })
    .filter(isEligible)
    .toSorted((left, right) => left.path.localeCompare(right.path));

  return yield* Effect.forEach(candidates, ({ path: relativePath, memoryLayer }) =>
    Effect.gen(function* () {
      const absolutePath = path.join(vaultPath, relativePath);
      const candidateRealPath = yield* fs.realPath(absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new ManagedMemoryError({
              reason: "ReadVaultFailed",
              message: `Failed to resolve managed memory document: ${relativePath}`,
              cause,
            }),
        ),
      );
      if (!isInsideVault(vaultRealPath, candidateRealPath, path)) {
        return yield* new ManagedMemoryError({
          reason: "UnsafeManagedPath",
          message: `Managed memory symlink resolves outside the vault: ${relativePath}`,
        });
      }
      const content = yield* fs.readFileString(absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new ManagedMemoryError({
              reason: "ReadVaultFailed",
              message: `Failed to read managed memory document: ${relativePath}`,
              cause,
            }),
        ),
      );
      return {
        path: relativePath,
        memoryLayer,
        content,
        contentHash: hashManagedMemoryContent(content),
      } satisfies ManagedMemoryDocument;
    }),
  );
});
