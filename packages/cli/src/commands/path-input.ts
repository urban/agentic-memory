import { AbsolutePath, decodeAbsolutePath } from "@urban/agentic-memory-core/link/LinkConfig";
import { Effect, FileSystem, Path, Schema } from "effect";
import { CliError, Flag } from "effect/unstable/cli";
import { toFailure } from "../output.ts";

type CliCommandFailure = import("../output.ts").CliCommandFailure;

const PathInput = Schema.NonEmptyString.annotate({ identifier: "CliPathInput" });
const decodePathInput = Schema.decodeUnknownEffect(PathInput);

const invalidDirectory = (value: string): CliError.InvalidValue =>
  new CliError.InvalidValue({
    option: "C",
    value,
    expected: "existing directory",
    kind: "flag",
  });

const resolveEffectiveDirectory = Effect.fnUntraced(function* (
  input: string,
): Effect.fn.Return<AbsolutePath, CliError.CliError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const decoded = yield* decodePathInput(input).pipe(
    Effect.mapError(() => invalidDirectory(input)),
  );
  const absolute = path.resolve(decoded);
  const real = yield* fs.realPath(absolute).pipe(Effect.mapError(() => invalidDirectory(input)));
  const info = yield* fs.stat(real).pipe(Effect.mapError(() => invalidDirectory(input)));
  if (info.type !== "Directory") {
    return yield* invalidDirectory(input);
  }
  return yield* decodeAbsolutePath(real).pipe(Effect.mapError(() => invalidDirectory(input)));
});

export const effectiveDirectoryFlag = Flag.string("directory").pipe(
  Flag.withAlias("C"),
  Flag.withDescription("Resolve relative paths from this directory without changing process state"),
  Flag.withDefault(process.cwd()),
  Flag.mapEffect(resolveEffectiveDirectory),
);

export const resolvePathInput = Effect.fnUntraced(function* (
  effectiveDirectory: AbsolutePath,
  input: string,
  label: string,
): Effect.fn.Return<AbsolutePath, CliCommandFailure, Path.Path> {
  const path = yield* Path.Path;
  const decoded = yield* decodePathInput(input).pipe(
    Effect.mapError(() =>
      toFailure({
        code: "InvalidPathInput",
        message: `${label} must be a non-empty path`,
        exitCode: 2,
      }),
    ),
  );
  return yield* decodeAbsolutePath(path.resolve(effectiveDirectory, decoded)).pipe(
    Effect.mapError((cause) =>
      toFailure({
        code: "InvalidPathInput",
        message: `${label} is invalid: ${cause.message}`,
        exitCode: 2,
      }),
    ),
  );
});
