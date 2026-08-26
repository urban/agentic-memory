import { Effect, FileSystem, Path, Schema } from "effect";
import { ProjectSlug } from "./ProjectSlug.ts";

export const LINK_DIRECTORY = ".agentic-memory-link";
export const CONFIG_FILENAME = "config.json";

export const AbsolutePath = Schema.String.check(
  Schema.isPattern(/^\//, {
    message: "Expected an absolute path",
  }),
).annotate({ identifier: "AbsolutePath" });
export type AbsolutePath = typeof AbsolutePath.Type;
export const decodeAbsolutePath = Schema.decodeUnknownEffect(AbsolutePath);

export const LinkConfig = Schema.Struct({
  version: Schema.Literal(1),
  vaultPath: AbsolutePath,
  projectSlug: ProjectSlug,
}).annotate({ identifier: "LinkConfig" });
export type LinkConfig = typeof LinkConfig.Type;

export const LocalLinkPaths = Schema.Struct({
  directory: Schema.String,
  configFile: Schema.String,
}).annotate({ identifier: "LocalLinkPaths" });
export type LocalLinkPaths = typeof LocalLinkPaths.Type;

export const LoadLinkConfigResult = Schema.TaggedUnion({
  missing: { paths: LocalLinkPaths },
  invalid: { paths: LocalLinkPaths, message: Schema.String },
  valid: { paths: LocalLinkPaths, config: LinkConfig },
}).annotate({ identifier: "LoadLinkConfigResult" });
export type LoadLinkConfigResult = typeof LoadLinkConfigResult.Type;

export class LinkConfigError extends Schema.TaggedError<LinkConfigError>()("LinkConfigError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const LinkConfigJson = Schema.fromJsonString(LinkConfig).annotate({
  identifier: "LinkConfigJson",
});

export const decodeLinkConfig = Schema.decodeUnknownEffect(LinkConfig);
export const decodeLinkConfigJson = Schema.decodeUnknownEffect(LinkConfigJson);
export const encodeLinkConfigJson = Schema.encodeUnknownEffect(LinkConfigJson);

const hasErrnoCode = (cause: unknown, code: string): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

const ensureNotSymlink = Effect.fnUntraced(function* (
  pathValue: string,
  label: string,
): Effect.fn.Return<void, LinkConfigError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(pathValue).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return;
  }

  yield* fs.readLink(pathValue).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        hasErrnoCode(cause.cause, "EINVAL")
          ? Effect.void
          : Effect.fail(
              LinkConfigError.make({
                message: `Failed to inspect ${label}: ${pathValue}`,
                cause,
              }),
            ),
      onSuccess: () =>
        Effect.fail(
          LinkConfigError.make({
            message: `${label} must not be a symlink: ${pathValue}`,
          }),
        ),
    }),
  );
});

const ensureLocalLinkPathsSafe = Effect.fnUntraced(function* (
  paths: LocalLinkPaths,
): Effect.fn.Return<void, LinkConfigError, FileSystem.FileSystem> {
  yield* ensureNotSymlink(paths.directory, "Local link directory");
  yield* ensureNotSymlink(paths.configFile, "Local config file");
});

export const localLinkPaths = Effect.fnUntraced(function* (
  projectRoot: string,
): Effect.fn.Return<LocalLinkPaths, never, Path.Path> {
  const path = yield* Path.Path;
  return LocalLinkPaths.make({
    directory: path.join(projectRoot, LINK_DIRECTORY),
    configFile: path.join(projectRoot, LINK_DIRECTORY, CONFIG_FILENAME),
  });
});

export const loadLinkConfig = Effect.fnUntraced(function* (
  projectRoot: string,
): Effect.fn.Return<LoadLinkConfigResult, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* localLinkPaths(projectRoot);
  const pathSafety = yield* ensureLocalLinkPathsSafe(paths).pipe(
    Effect.match({
      onFailure: (error) => error,
      onSuccess: () => {},
    }),
  );

  if (pathSafety !== undefined) {
    return LoadLinkConfigResult.cases.invalid.make({
      paths,
      message: pathSafety.message,
    });
  }
  const exists = yield* fs.exists(paths.configFile).pipe(Effect.orElseSucceed(() => false));

  if (!exists) {
    return LoadLinkConfigResult.cases.missing.make({ paths });
  }

  const readResult = yield* fs.readFileString(paths.configFile).pipe(
    Effect.match({
      onFailure: (cause) =>
        LoadLinkConfigResult.cases.invalid.make({
          paths,
          message: `Failed to read config file: ${paths.configFile}: ${String(cause)}`,
        }),
      onSuccess: (contents) => contents,
    }),
  );

  if (typeof readResult !== "string") {
    return readResult;
  }

  return yield* decodeLinkConfigJson(readResult).pipe(
    Effect.match({
      onFailure: (error) =>
        LoadLinkConfigResult.cases.invalid.make({
          paths,
          message: `Invalid .agentic-memory-link/config.json: ${error.message}`,
        }),
      onSuccess: (config) => LoadLinkConfigResult.cases.valid.make({ paths, config }),
    }),
  );
});

export const writeLinkConfig = Effect.fnUntraced(function* (
  projectRoot: string,
  config: LinkConfig,
): Effect.fn.Return<LocalLinkPaths, LinkConfigError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* localLinkPaths(projectRoot);
  yield* ensureLocalLinkPathsSafe(paths);
  const encoded = yield* encodeLinkConfigJson(config).pipe(
    Effect.mapError((cause) =>
      LinkConfigError.make({
        message: "Failed to encode link config JSON",
        cause,
      }),
    ),
  );

  yield* fs.makeDirectory(paths.directory, { recursive: true }).pipe(
    Effect.mapError((cause) =>
      LinkConfigError.make({
        message: `Failed to create link directory: ${paths.directory}`,
        cause,
      }),
    ),
  );
  yield* ensureLocalLinkPathsSafe(paths);

  yield* fs.writeFileString(paths.configFile, `${encoded}\n`).pipe(
    Effect.mapError((cause) =>
      LinkConfigError.make({
        message: `Failed to write link config: ${paths.configFile}`,
        cause,
      }),
    ),
  );

  return paths;
});
