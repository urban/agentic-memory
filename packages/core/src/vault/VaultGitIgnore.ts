import { Effect, FileSystem, Path, Schema } from "effect";

export const SEMANTIC_INDEX_GITIGNORE_ENTRY = ".agentic-memory/index/";

export class VaultGitIgnoreError extends Schema.TaggedErrorClass<VaultGitIgnoreError>()(
  "VaultGitIgnoreError",
  {
    reason: Schema.Literals(["unsafe_symlink", "inspection_failed", "read_failed", "write_failed"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const hasErrnoCode = (cause: unknown, code: string): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

const ensureGitIgnorePathSafe = Effect.fnUntraced(function* (
  ignorePath: string,
): Effect.fn.Return<void, VaultGitIgnoreError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.readLink(ignorePath).pipe(
    Effect.matchEffect({
      onFailure: (cause) => {
        if (cause.reason._tag === "NotFound" || hasErrnoCode(cause.cause, "EINVAL")) {
          return Effect.void;
        }
        return Effect.fail(
          new VaultGitIgnoreError({
            reason: "inspection_failed",
            message: `Failed to inspect vault Git ignore path: ${ignorePath}`,
            cause,
          }),
        );
      },
      onSuccess: () =>
        Effect.fail(
          new VaultGitIgnoreError({
            reason: "unsafe_symlink",
            message: `Vault Git ignore file must not be a symlink: ${ignorePath}`,
          }),
        ),
    }),
  );
});

export const ensureSemanticIndexGitIgnore = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<boolean, VaultGitIgnoreError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ignorePath = path.join(vaultPath, ".gitignore");
  yield* ensureGitIgnorePathSafe(ignorePath);
  const existing = yield* fs.readFileString(ignorePath).pipe(
    Effect.catchTag("PlatformError", (error) =>
      error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
    ),
    Effect.mapError(
      (cause) =>
        new VaultGitIgnoreError({
          reason: "read_failed",
          message: `Failed to read vault Git ignore file: ${ignorePath}`,
          cause,
        }),
    ),
  );

  if (
    existing
      .split("\n")
      .some(
        (line) =>
          line === SEMANTIC_INDEX_GITIGNORE_ENTRY || line === `${SEMANTIC_INDEX_GITIGNORE_ENTRY}\r`,
      )
  ) {
    return false;
  }

  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const next = `${existing}${separator}${SEMANTIC_INDEX_GITIGNORE_ENTRY}\n`;
  yield* fs.writeFileString(ignorePath, next).pipe(
    Effect.mapError(
      (cause) =>
        new VaultGitIgnoreError({
          reason: "write_failed",
          message: `Failed to update vault Git ignore file: ${ignorePath}`,
          cause,
        }),
    ),
  );
  return true;
});
