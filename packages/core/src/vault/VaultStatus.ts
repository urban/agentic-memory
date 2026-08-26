import { Effect, FileSystem, Path, Schema } from "effect";
import { projectFileRelativePathFromSlug } from "../link/ProjectSlug.ts";
import { hasProjectRouteInMemory } from "./ProjectRoute.ts";

type ProjectSlug = import("../link/ProjectSlug.ts").ProjectSlug;

export const VaultHealth = Schema.Struct({
  path: Schema.String,
  healthy: Schema.Boolean,
  exists: Schema.Boolean,
  memoryFileExists: Schema.Boolean,
  userFileExists: Schema.Boolean,
  outsideVaultInstructionsExists: Schema.Boolean,
  sessionCaptureInstructionsExists: Schema.Boolean,
  projectsDirectoryExists: Schema.Boolean,
  projectFileExists: Schema.Boolean,
  memoryRouteExists: Schema.Boolean,
}).annotate({ identifier: "VaultHealth" });
export type VaultHealth = typeof VaultHealth.Type;

export class VaultStatusError extends Schema.TaggedError<VaultStatusError>()("VaultStatusError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export type VaultPaths = {
  readonly root: string;
  readonly memoryFile: string;
  readonly userFile: string;
  readonly projectsDirectory: string;
  readonly projectFile: string;
  readonly outsideVaultInstructions: string;
  readonly sessionCaptureInstructions: string;
};

export const resolveVaultPaths = Effect.fnUntraced(function* (input: {
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
}): Effect.fn.Return<VaultPaths, never, Path.Path> {
  const path = yield* Path.Path;
  return {
    root: input.vaultPath,
    memoryFile: path.join(input.vaultPath, "MEMORY.md"),
    userFile: path.join(input.vaultPath, "USER.md"),
    projectsDirectory: path.join(input.vaultPath, "projects"),
    projectFile: path.join(input.vaultPath, projectFileRelativePathFromSlug(input.projectSlug)),
    outsideVaultInstructions: path.join(input.vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
    sessionCaptureInstructions: path.join(
      input.vaultPath,
      ".agentic-memory",
      "instructions",
      "session-capture.md",
    ),
  };
});

const existsOrFalse = (pathValue: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(pathValue).pipe(Effect.orElseSucceed(() => false));
  });

export const checkVaultHealth = Effect.fnUntraced(function* (input: {
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
}): Effect.fn.Return<VaultHealth, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* resolveVaultPaths(input);
  const pathIsAbsolute = path.isAbsolute(input.vaultPath);
  const exists = pathIsAbsolute ? yield* existsOrFalse(paths.root) : false;
  const memoryFileExists = pathIsAbsolute ? yield* existsOrFalse(paths.memoryFile) : false;
  const userFileExists = pathIsAbsolute ? yield* existsOrFalse(paths.userFile) : false;
  const outsideVaultInstructionsExists = pathIsAbsolute
    ? yield* existsOrFalse(paths.outsideVaultInstructions)
    : false;
  const sessionCaptureInstructionsExists = pathIsAbsolute
    ? yield* existsOrFalse(paths.sessionCaptureInstructions)
    : false;
  const projectsDirectoryExists = pathIsAbsolute
    ? yield* existsOrFalse(paths.projectsDirectory)
    : false;
  const projectFileExists = pathIsAbsolute ? yield* existsOrFalse(paths.projectFile) : false;
  const memoryRouteExists =
    memoryFileExists && pathIsAbsolute
      ? yield* fs.readFileString(paths.memoryFile).pipe(
          Effect.map((contents) => hasProjectRouteInMemory(contents, input.projectSlug)),
          Effect.orElseSucceed(() => false),
        )
      : false;
  const healthy =
    pathIsAbsolute &&
    exists &&
    memoryFileExists &&
    userFileExists &&
    outsideVaultInstructionsExists &&
    sessionCaptureInstructionsExists &&
    projectsDirectoryExists &&
    projectFileExists &&
    memoryRouteExists;

  return VaultHealth.make({
    path: input.vaultPath,
    healthy,
    exists,
    memoryFileExists,
    userFileExists,
    outsideVaultInstructionsExists,
    sessionCaptureInstructionsExists,
    projectsDirectoryExists,
    projectFileExists,
    memoryRouteExists,
  });
});

export const validateVaultForLink = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<void, VaultStatusError, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  if (!path.isAbsolute(vaultPath)) {
    return yield* VaultStatusError.make({ message: `Vault path must be absolute: ${vaultPath}` });
  }

  const memoryFile = path.join(vaultPath, "MEMORY.md");
  const userFile = path.join(vaultPath, "USER.md");
  const outsideVaultInstructions = path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md");
  const sessionCaptureInstructions = path.join(
    vaultPath,
    ".agentic-memory",
    "instructions",
    "session-capture.md",
  );
  const projectsDirectory = path.join(vaultPath, "projects");
  const required = [
    { label: "vault root", path: vaultPath },
    { label: "MEMORY.md", path: memoryFile },
    { label: "USER.md", path: userFile },
    { label: ".agentic-memory/LLM-outside-vault.md", path: outsideVaultInstructions },
    { label: ".agentic-memory/instructions/session-capture.md", path: sessionCaptureInstructions },
    { label: "projects/", path: projectsDirectory },
  ];

  for (const entry of required) {
    const exists = yield* existsOrFalse(entry.path);
    if (!exists) {
      return yield* VaultStatusError.make({
        message: `Vault is missing ${entry.label}: ${entry.path}`,
      });
    }
  }
});

export const validateVaultForSteward = Effect.fnUntraced(function* (input: {
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
}): Effect.fn.Return<void, VaultStatusError, FileSystem.FileSystem | Path.Path> {
  const health = yield* checkVaultHealth(input);
  if (!health.healthy) {
    return yield* VaultStatusError.make({
      message: `Linked vault is unhealthy for project ${input.projectSlug}`,
    });
  }
});
