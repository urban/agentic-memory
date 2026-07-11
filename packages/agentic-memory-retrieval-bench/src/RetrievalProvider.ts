import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";

export const MemoryLayer = Schema.Literals([
  "core",
  "user",
  "map",
  "project",
  "note",
  "person",
  "record",
  "source",
]).annotate({ identifier: "MemoryLayer" });

export type MemoryLayer =
  | "core"
  | "user"
  | "map"
  | "project"
  | "note"
  | "person"
  | "record"
  | "source";

export const RetrievalResult = Schema.Struct({
  path: Schema.String,
  memoryLayer: MemoryLayer,
  score: Schema.Number,
  snippet: Schema.String,
}).annotate({ identifier: "RetrievalResult" });

export type RetrievalResult = {
  readonly path: string;
  readonly memoryLayer: MemoryLayer;
  readonly score: number;
  readonly snippet: string;
};

export type RetrievalRequest = {
  readonly vaultPath: string;
  readonly query: string;
  readonly limit: number;
  readonly includeSources: boolean;
  readonly projectSlug?: string;
};

export type RetrievalProvider = {
  readonly name: string;
  readonly retrieve: (
    request: RetrievalRequest,
  ) => Effect.Effect<
    ReadonlyArray<RetrievalResult>,
    PlatformError.PlatformError,
    FileSystem.FileSystem | Path.Path
  >;
};

const managedPrefixes = [
  ["maps/", "map"],
  ["projects/", "project"],
  ["notes/", "note"],
  ["people/", "person"],
  ["records/", "record"],
  ["sources/", "source"],
] satisfies ReadonlyArray<readonly [string, MemoryLayer]>;

export const classifyMemoryLayer = (relativePath: string): MemoryLayer | undefined => {
  if (relativePath === "MEMORY.md") {
    return "core";
  }
  if (relativePath === "USER.md") {
    return "user";
  }
  return managedPrefixes.find(([prefix]) => relativePath.startsWith(prefix))?.[1];
};

export const isVaultRelativeMarkdownPath = (relativePath: string): boolean => {
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
  isVaultRelativeMarkdownPath(relativePath) && classifyMemoryLayer(relativePath) !== undefined;
