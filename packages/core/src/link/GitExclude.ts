import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const GIT_EXCLUDE_ENTRY = ".agentic-memory-link/";

export class GitExcludeError extends Schema.TaggedError<GitExcludeError>()("GitExcludeError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const resolveGitDir = Effect.fnUntraced(function* (
  projectRoot: string,
): Effect.fn.Return<string | void, never, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make("git", ["rev-parse", "--git-dir"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      const result = yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      );

      if (result.exitCode !== ChildProcessSpawner.ExitCode(0)) {
        return;
      }

      const gitDir = result.stdout.trim();
      if (gitDir.length === 0) {
        return;
      }

      return gitDir.startsWith("/") ? gitDir : `${projectRoot}/${gitDir}`;
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: 5_000,
      orElse: () => Effect.void,
    }),
    Effect.orElseSucceed(() => undefined),
  );
});

export const ensureGitExcludeEntry = Effect.fnUntraced(function* (
  projectRoot: string,
  entry: string = GIT_EXCLUDE_ENTRY,
): Effect.fn.Return<
  { readonly updated: boolean; readonly warning: string | undefined },
  GitExcludeError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const gitDir = yield* resolveGitDir(projectRoot);
  if (gitDir === undefined) {
    return {
      updated: false,
      warning: ".agentic-memory-link/ is local config; no Git worktree was found for auto-exclude.",
    };
  }

  const excludePath = `${gitDir}/info/exclude`;
  const existing = yield* fs.readFileString(excludePath).pipe(
    Effect.catchTag("PlatformError", (error) =>
      error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
    ),
    Effect.mapError((cause) =>
      GitExcludeError.make({
        message: `Failed to read git exclude file: ${excludePath}`,
        cause,
      }),
    ),
  );

  if (existing.split("\n").some((line) => line.trim() === entry)) {
    return { updated: false, warning: undefined };
  }

  const next = existing.trimEnd().length === 0 ? `${entry}\n` : `${existing.trimEnd()}\n${entry}\n`;
  const infoDirectory = `${gitDir}/info`;

  yield* fs.makeDirectory(infoDirectory, { recursive: true }).pipe(
    Effect.mapError((cause) =>
      GitExcludeError.make({
        message: `Failed to create git info directory: ${infoDirectory}`,
        cause,
      }),
    ),
  );
  yield* fs.writeFileString(excludePath, next).pipe(
    Effect.mapError((cause) =>
      GitExcludeError.make({
        message: `Failed to update git exclude file: ${excludePath}`,
        cause,
      }),
    ),
  );

  return { updated: true, warning: undefined };
});
