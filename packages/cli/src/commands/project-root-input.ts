import { decodeAbsolutePath } from "@urban/agentic-memory-core/link/LinkConfig";
import { Effect, Option, Path } from "effect";
import { Flag } from "effect/unstable/cli";
import { toFailure } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";

type AbsolutePath = import("@urban/agentic-memory-core/link/LinkConfig").AbsolutePath;
type CliCommandFailure = import("../output.ts").CliCommandFailure;
type InvocationDirectory = import("./path-input.ts").InvocationDirectory;

export const projectRootFlag = Flag.string("project-root").pipe(
  Flag.withDescription("Project root containing .agentic-memory-link/config.json"),
  Flag.withDefault("."),
);

export const compatibilityProjectRootFlag = Flag.string("project-root").pipe(
  Flag.withDescription(
    "Deprecated project root containing .agentic-memory-link/config.json; use -C instead",
  ),
  Flag.optional,
);

export const resolveCompatibilityProjectRoot = Effect.fnUntraced(function* (
  directory: InvocationDirectory,
  projectRoot: Option.Option<string>,
): Effect.fn.Return<AbsolutePath, CliCommandFailure, Path.Path> {
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

  if (
    directory.explicit &&
    Option.isSome(projectRoot) &&
    compatibilityDirectory !== directory.path
  ) {
    return yield* toFailure({
      code: "ConflictingDirectoryContext",
      message: `Explicit -C directory conflicts with --project-root: ${directory.path} != ${compatibilityDirectory}`,
      exitCode: 2,
    });
  }

  return compatibilityDirectory;
});

export const resolveProjectRoot = Effect.fnUntraced(function* (projectRoot: string) {
  const path = yield* Path.Path;
  return path.resolve(projectRoot);
});
