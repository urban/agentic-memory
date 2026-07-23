import { decodeAbsolutePath } from "@urban/agentic-memory-core/link/LinkConfig";
import { Effect, FileSystem, Option, Path } from "effect";
import { Flag } from "effect/unstable/cli";
import { toFailure } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";

type AbsolutePath = import("@urban/agentic-memory-core/link/LinkConfig").AbsolutePath;
type CliCommandFailure = import("../output.ts").CliCommandFailure;
type InvocationDirectory = import("./path-input.ts").InvocationDirectory;

const conflictingDirectoryContext = (
  directory: AbsolutePath,
  projectRoot: AbsolutePath,
): CliCommandFailure =>
  toFailure({
    code: "ConflictingDirectoryContext",
    message: `Explicit -C directory conflicts with --project-root: ${directory} != ${projectRoot}`,
    exitCode: 2,
  });

const canonicalizeProjectRoot = Effect.fnUntraced(function* (
  projectRoot: AbsolutePath,
): Effect.fn.Return<AbsolutePath, CliCommandFailure, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(projectRoot).pipe(
    Effect.flatMap(decodeAbsolutePath),
    Effect.mapError((cause) =>
      toFailure({
        code: "InvalidProjectRoot",
        message: `Project root is invalid: ${cause.message}`,
        exitCode: 2,
      }),
    ),
  );
});

export const compatibilityProjectRootFlag = Flag.string("project-root").pipe(
  Flag.withDescription(
    "Deprecated project root containing .agentic-memory-link/config.json; use -C instead",
  ),
  Flag.optional,
);

export const resolveCompatibilityProjectRoot = Effect.fnUntraced(function* (
  directory: InvocationDirectory,
  projectRoot: Option.Option<string>,
): Effect.fn.Return<AbsolutePath, CliCommandFailure, FileSystem.FileSystem | Path.Path> {
  const compatibilityDirectory = Option.isSome(projectRoot)
    ? yield* resolvePathInput(
        yield* decodeAbsolutePath(process.cwd()).pipe(
          Effect.mapError((cause) =>
            toFailure({
              code: "InvalidProjectRoot",
              message: `Project root base is invalid: ${cause.message}`,
              exitCode: 2,
            }),
          ),
        ),
        projectRoot.value,
        "Project root",
      )
    : directory.path;

  if (Option.isSome(projectRoot)) {
    const canonicalCompatibilityDirectory = yield* canonicalizeProjectRoot(
      compatibilityDirectory,
    ).pipe(
      Effect.catch((cause) =>
        directory.explicit
          ? Effect.fail(conflictingDirectoryContext(directory.path, compatibilityDirectory))
          : Effect.fail(cause),
      ),
    );
    if (directory.explicit && canonicalCompatibilityDirectory !== directory.path) {
      return yield* conflictingDirectoryContext(directory.path, canonicalCompatibilityDirectory);
    }
    return canonicalCompatibilityDirectory;
  }

  return compatibilityDirectory;
});
