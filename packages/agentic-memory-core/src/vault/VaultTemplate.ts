import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class VaultTemplateError extends Schema.TaggedErrorClass<VaultTemplateError>()(
  "VaultTemplateError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface InitVaultResult {
  readonly status: "initialized" | "already_initialized";
  readonly vaultPath: string;
  readonly changes: {
    readonly createdDirectory: boolean;
    readonly copiedTemplate: boolean;
    readonly initializedGit: boolean;
  };
  readonly warnings: ReadonlyArray<string>;
}

export interface InitVaultOptions {
  readonly targetPath: string;
  readonly initializeGit: boolean;
  readonly yes: boolean;
}

const bundledTemplatePath = Effect.fnUntraced(function* (): Effect.fn.Return<
  string,
  never,
  Path.Path
> {
  const path = yield* Path.Path;
  return path.join(import.meta.dir, "..", "..", "template");
});

const existsOrFalse = (pathValue: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(pathValue).pipe(Effect.catch(() => Effect.succeed(false)));
  });

const isCompatibleVault = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const required = [
    "MEMORY.md",
    "USER.md",
    path.join(".agentic-memory", "LLM-outside-vault.md"),
    "projects",
  ];

  for (const relative of required) {
    const exists = yield* existsOrFalse(path.join(vaultPath, relative));
    if (!exists) {
      return false;
    }
  }

  return true;
});

const isDirectoryEmpty = Effect.fnUntraced(function* (
  directoryPath: string,
): Effect.fn.Return<boolean, VaultTemplateError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(directoryPath).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to inspect target directory: ${directoryPath}`,
          cause,
        }),
    ),
  );
  return entries.length === 0;
});

const runGitInit = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<
  boolean,
  VaultTemplateError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const gitDirectoryExists = yield* fs.exists(`${vaultPath}/.git`).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to inspect git directory for vault: ${vaultPath}`,
          cause,
        }),
    ),
  );
  if (gitDirectoryExists) {
    return false;
  }

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make("git", ["init"], {
    cwd: vaultPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command).pipe(
        Effect.mapError(
          (cause) =>
            new VaultTemplateError({
              message: "Failed to launch git init",
              cause,
            }),
        ),
      );
      const result = yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new VaultTemplateError({
              message: "Failed while running git init",
              cause,
            }),
        ),
      );

      if (result.exitCode !== ChildProcessSpawner.ExitCode(0)) {
        return yield* new VaultTemplateError({
          message: "git init failed for new Agentic Memory vault",
          cause: result.stderr.trim(),
        });
      }

      return true;
    }),
  );
});

export const initVaultFromTemplate = Effect.fnUntraced(function* (
  options: InitVaultOptions,
): Effect.fn.Return<
  InitVaultResult,
  VaultTemplateError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!path.isAbsolute(options.targetPath)) {
    return yield* new VaultTemplateError({
      message: `Vault target path must be absolute: ${options.targetPath}`,
    });
  }

  const targetExists = yield* fs.exists(options.targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to inspect target path: ${options.targetPath}`,
          cause,
        }),
    ),
  );

  if (targetExists && (yield* isCompatibleVault(options.targetPath))) {
    const initializedGit = options.initializeGit ? yield* runGitInit(options.targetPath) : false;
    return {
      status: "already_initialized",
      vaultPath: options.targetPath,
      changes: {
        createdDirectory: false,
        copiedTemplate: false,
        initializedGit,
      },
      warnings: [],
    };
  }

  if (targetExists) {
    const empty = yield* isDirectoryEmpty(options.targetPath);
    if (!empty) {
      return yield* new VaultTemplateError({
        message:
          "Target exists and is not an initialized Agentic Memory vault or empty directory; refusing to overwrite.",
      });
    }
  } else {
    yield* fs.makeDirectory(options.targetPath, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new VaultTemplateError({
            message: `Failed to create vault target directory: ${options.targetPath}`,
            cause,
          }),
      ),
    );
  }

  const templatePath = yield* bundledTemplatePath();
  yield* fs.copy(templatePath, options.targetPath, { overwrite: false }).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to copy bundled Agentic Memory template into: ${options.targetPath}`,
          cause,
        }),
    ),
  );

  const initializedGit = options.initializeGit ? yield* runGitInit(options.targetPath) : false;

  return {
    status: "initialized",
    vaultPath: options.targetPath,
    changes: {
      createdDirectory: !targetExists,
      copiedTemplate: true,
      initializedGit,
    },
    warnings: [],
  };
});
