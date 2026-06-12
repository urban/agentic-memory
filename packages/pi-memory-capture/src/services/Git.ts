import { Context, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class GitServiceError extends Schema.TaggedErrorClass<GitServiceError>()("GitServiceError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class Git extends Context.Service<
  Git,
  {
    readonly resolveGitDir: (cwd: string) => Effect.Effect<string | undefined>;
    readonly ensureInfoExcludeEntry: (
      gitDir: string,
      entry: string,
    ) => Effect.Effect<boolean, GitServiceError>;
  }
>()("@urban/pi-memory-capture/services/Git") {
  static readonly layer = Layer.effect(
    Git,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const resolveGitDir = Effect.fn("Git.resolveGitDir")(function* (cwd: string) {
        const command = ChildProcess.make("git", ["rev-parse", "--git-dir"], {
          cwd,
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
              return undefined;
            }

            const gitDir = result.stdout.trim();
            if (gitDir.length === 0) {
              return undefined;
            }

            return gitDir.startsWith("/") ? gitDir : `${cwd}/${gitDir}`;
          }),
        ).pipe(
          Effect.timeoutOrElse({
            duration: 5_000,
            orElse: () => Effect.void.pipe(Effect.as(undefined)),
          }),
          Effect.catch(() => Effect.void.pipe(Effect.as(undefined))),
        );
      });

      const ensureInfoExcludeEntry = Effect.fn("Git.ensureInfoExcludeEntry")(function* (
        gitDir: string,
        entry: string,
      ): Effect.fn.Return<boolean, GitServiceError> {
        const excludePath = `${gitDir}/info/exclude`;
        const existing = yield* fs.readFileString(excludePath).pipe(
          Effect.catchTag("PlatformError", (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
          ),
          Effect.mapError(
            (cause) =>
              new GitServiceError({
                message: `Failed to read git exclude file: ${excludePath}`,
                cause,
              }),
          ),
        );

        if (existing.split("\n").some((line) => line.trim() === entry)) {
          return false;
        }

        const next =
          existing.trimEnd().length === 0 ? `${entry}\n` : `${existing.trimEnd()}\n${entry}\n`;
        const infoDirectory = `${gitDir}/info`;

        yield* fs.makeDirectory(infoDirectory, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new GitServiceError({
                message: `Failed to create git info directory: ${infoDirectory}`,
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(excludePath, next).pipe(
          Effect.mapError(
            (cause) =>
              new GitServiceError({
                message: `Failed to update git exclude file: ${excludePath}`,
                cause,
              }),
          ),
        );

        return true;
      });

      return Git.of({
        resolveGitDir,
        ensureInfoExcludeEntry,
      });
    }),
  );
}
