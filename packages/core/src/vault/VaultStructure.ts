import { Effect, FileSystem, Path, PlatformError } from "effect";

export interface InitializedVaultStructure {
  readonly initialized: boolean;
  readonly violations: ReadonlyArray<InitializedVaultStructureViolation>;
}

type InitializedVaultEntryType = "File" | "Directory";

export type InitializedVaultStructureViolation =
  | {
      readonly reason: "missing";
      readonly label: string;
      readonly path: string;
      readonly expectedType: InitializedVaultEntryType;
    }
  | {
      readonly reason: "wrong_type";
      readonly label: string;
      readonly path: string;
      readonly expectedType: InitializedVaultEntryType;
      readonly actualType: FileSystem.File.Type;
    };

interface RequiredInitializedVaultEntry {
  readonly label: string;
  readonly relativePath: string;
  readonly expectedType: InitializedVaultEntryType;
}

const requiredInitializedVaultEntries = (
  path: Path.Path,
): ReadonlyArray<RequiredInitializedVaultEntry> => [
  { label: "AGENTS.md", relativePath: "AGENTS.md", expectedType: "File" },
  { label: "MEMORY.md", relativePath: "MEMORY.md", expectedType: "File" },
  { label: "USER.md", relativePath: "USER.md", expectedType: "File" },
  {
    label: ".agentic-memory/LLM-vault-local.md",
    relativePath: path.join(".agentic-memory", "LLM-vault-local.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/LLM-outside-vault.md",
    relativePath: path.join(".agentic-memory", "LLM-outside-vault.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/adapters/MEMORY_ADAPTER.md",
    relativePath: path.join(".agentic-memory", "adapters", "MEMORY_ADAPTER.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/instructions/session-capture.md",
    relativePath: path.join(".agentic-memory", "instructions", "session-capture.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/instructions/writing-memory.md",
    relativePath: path.join(".agentic-memory", "instructions", "writing-memory.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/instructions/linking-and-maps.md",
    relativePath: path.join(".agentic-memory", "instructions", "linking-and-maps.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/instructions/cross-project-persistence.md",
    relativePath: path.join(".agentic-memory", "instructions", "cross-project-persistence.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/instructions/reflection.md",
    relativePath: path.join(".agentic-memory", "instructions", "reflection.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/map.md",
    relativePath: path.join(".agentic-memory", "templates", "map.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/project.md",
    relativePath: path.join(".agentic-memory", "templates", "project.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/note.md",
    relativePath: path.join(".agentic-memory", "templates", "note.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/person.md",
    relativePath: path.join(".agentic-memory", "templates", "person.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/record.md",
    relativePath: path.join(".agentic-memory", "templates", "record.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/reflection-record.md",
    relativePath: path.join(".agentic-memory", "templates", "reflection-record.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/source.md",
    relativePath: path.join(".agentic-memory", "templates", "source.md"),
    expectedType: "File",
  },
  {
    label: ".agentic-memory/templates/user.md",
    relativePath: path.join(".agentic-memory", "templates", "user.md"),
    expectedType: "File",
  },
  { label: "maps/", relativePath: "maps", expectedType: "Directory" },
  { label: "notes/", relativePath: "notes", expectedType: "Directory" },
  { label: "people/", relativePath: "people", expectedType: "Directory" },
  { label: "projects/", relativePath: "projects", expectedType: "Directory" },
  { label: "records/", relativePath: "records", expectedType: "Directory" },
  { label: "sources/", relativePath: "sources", expectedType: "Directory" },
];

export const inspectInitializedVaultStructure = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  InitializedVaultStructure,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const violations: Array<InitializedVaultStructureViolation> = [];

  for (const entry of requiredInitializedVaultEntries(path)) {
    const entryPath = path.join(vaultPath, entry.relativePath);
    if (!(yield* fs.exists(entryPath))) {
      violations.push({
        reason: "missing",
        label: entry.label,
        path: entryPath,
        expectedType: entry.expectedType,
      });
      continue;
    }
    const info = yield* fs
      .stat(entryPath)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));
    if (info === undefined) {
      violations.push({
        reason: "missing",
        label: entry.label,
        path: entryPath,
        expectedType: entry.expectedType,
      });
      continue;
    }
    if (info.type !== entry.expectedType) {
      violations.push({
        reason: "wrong_type",
        label: entry.label,
        path: entryPath,
        expectedType: entry.expectedType,
        actualType: info.type,
      });
    }
  }

  return {
    initialized: violations.length === 0,
    violations,
  };
});
