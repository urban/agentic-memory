import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Path, PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { afterAll } from "vitest";
import { ensureGitExcludeEntry, GIT_EXCLUDE_ENTRY } from "../src/link/GitExclude.ts";

const GitExcludeRuntime = ManagedRuntime.make(BunServices.layer);

const initializeGitRepository = Effect.fnUntraced(function* (
  projectRoot: string,
): Effect.fn.Return<void, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("git", ["init"], {
      cwd: projectRoot,
      stdout: "ignore",
      stderr: "ignore",
    }),
  );

  assert.strictEqual(exitCode, ChildProcessSpawner.ExitCode(0));
});

describe("Git exclude policy", () => {
  afterAll(() => GitExcludeRuntime.dispose());

  it.effect("warns without updating when the project is not in a Git worktree", () =>
    GitExcludeRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const projectRoot = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-git-exclude-no-worktree-",
              });

              const result = yield* ensureGitExcludeEntry(projectRoot);

              assert.deepStrictEqual(result, {
                updated: false,
                warning:
                  ".agentic-memory-link/ is local config; no Git worktree was found for auto-exclude.",
              });
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("preserves existing excludes and adds the local link entry once", () =>
    GitExcludeRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const projectRoot = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-git-exclude-update-",
              });
              yield* initializeGitRepository(projectRoot);
              const excludePath = path.join(projectRoot, ".git", "info", "exclude");
              const before = yield* fs.readFileString(excludePath);

              const first = yield* ensureGitExcludeEntry(projectRoot);
              const second = yield* ensureGitExcludeEntry(projectRoot);
              const after = yield* fs.readFileString(excludePath);

              assert.deepStrictEqual(first, { updated: true, warning: undefined });
              assert.deepStrictEqual(second, { updated: false, warning: undefined });
              assert.strictEqual(after, `${before.trimEnd()}\n${GIT_EXCLUDE_ENTRY}\n`);
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("reports a typed error when the exclude file cannot be read", () =>
    GitExcludeRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const projectRoot = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-git-exclude-read-error-",
              });
              yield* initializeGitRepository(projectRoot);
              const excludePath = path.join(projectRoot, ".git", "info", "exclude");
              yield* fs.remove(excludePath);
              yield* fs.makeDirectory(excludePath);

              const error = yield* ensureGitExcludeEntry(projectRoot).pipe(Effect.flip);

              assert.strictEqual(error._tag, "GitExcludeError");
              assert.strictEqual(error.message, `Failed to read git exclude file: ${excludePath}`);
            }),
          ),
          context,
        ),
      ),
    ),
  );
});
