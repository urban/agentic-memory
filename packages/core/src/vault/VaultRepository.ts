import { Context, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ensureSemanticIndexGitIgnore, VaultGitIgnoreError } from "./VaultGitIgnore.ts";

export interface VaultRepositorySetupOptions {
  readonly vaultPath: string;
  readonly initializeGit: boolean;
}

export interface VaultRepositorySetupResult {
  readonly initializedGit: boolean;
  readonly updatedGitIgnore: boolean;
}

export class VaultGitInitializationError extends Schema.TaggedErrorClass<VaultGitInitializationError>()(
  "VaultGitInitializationError",
  {
    reason: Schema.Literals([
      "InspectionFailed",
      "LaunchFailed",
      "ExecutionFailed",
      "CommandFailed",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class VaultRepository extends Context.Service<
  VaultRepository,
  {
    readonly setup: (
      options: VaultRepositorySetupOptions,
    ) => Effect.Effect<
      VaultRepositorySetupResult,
      VaultGitIgnoreError | VaultGitInitializationError
    >;
  }
>()("@urban/agentic-memory-core/vault/VaultRepository") {}

const makeVaultRepository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runGitInit = Effect.fnUntraced(function* (vaultPath: string) {
    const gitDirectoryExists = yield* fs.exists(path.join(vaultPath, ".git")).pipe(
      Effect.mapError(
        (cause) =>
          new VaultGitInitializationError({
            reason: "InspectionFailed",
            message: `Failed to inspect git directory for vault: ${vaultPath}`,
            cause,
          }),
      ),
    );
    if (gitDirectoryExists) {
      return false;
    }

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
              new VaultGitInitializationError({
                reason: "LaunchFailed",
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
              new VaultGitInitializationError({
                reason: "ExecutionFailed",
                message: "Failed while running git init",
                cause,
              }),
          ),
        );

        if (result.exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new VaultGitInitializationError({
            reason: "CommandFailed",
            message: "git init failed for new Agentic Memory vault",
            cause: result.stderr.trim(),
          });
        }

        return true;
      }),
    );
  });

  const setup = Effect.fnUntraced(function* (options: VaultRepositorySetupOptions) {
    const updatedGitIgnore = yield* ensureSemanticIndexGitIgnore(options.vaultPath).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
    const initializedGit = options.initializeGit ? yield* runGitInit(options.vaultPath) : false;
    return { initializedGit, updatedGitIgnore };
  });

  return VaultRepository.of({ setup });
});

export const VaultRepositoryLive: Layer.Layer<
  VaultRepository,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Layer.effect(VaultRepository, makeVaultRepository);
