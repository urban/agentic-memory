import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, ManagedRuntime, Path, PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { afterAll } from "vitest";
import {
  ensureSemanticIndexGitIgnore,
  SEMANTIC_INDEX_GITIGNORE_ENTRY,
  VaultGitIgnoreError,
} from "../src/vault/VaultGitIgnore.ts";
import { makeFakeEmbeddingModelLayer } from "../src/semantic/EmbeddingModel.ts";
import { initVaultFromTemplate, VaultTemplateError } from "../src/vault/VaultTemplate.ts";

const VaultGitIgnoreRuntime = ManagedRuntime.make(
  BunServices.layer.pipe(Layer.merge(makeFakeEmbeddingModelLayer())),
);

const runGit = Effect.fnUntraced(function* (
  repositoryPath: string,
  arguments_: ReadonlyArray<string>,
): Effect.fn.Return<
  ChildProcessSpawner.ExitCode,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(
    ChildProcess.make("git", [...arguments_], {
      cwd: repositoryPath,
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
});

const initializeGitRepository = (repositoryPath: string) =>
  Effect.gen(function* () {
    const exitCode = yield* runGit(repositoryPath, ["init"]);
    assert.strictEqual(exitCode, ChildProcessSpawner.ExitCode(0));
  });

const assertGitIgnored = (repositoryPath: string, relativePath: string) =>
  Effect.gen(function* () {
    const exitCode = yield* runGit(repositoryPath, ["check-ignore", "--quiet", "--", relativePath]);
    assert.strictEqual(exitCode, ChildProcessSpawner.ExitCode(0));
  });

describe("vault Git-ignore policy", () => {
  afterAll(() => VaultGitIgnoreRuntime.dispose());

  it.effect("rejects a symlink without mutating its external target during repair or init", () =>
    VaultGitIgnoreRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const tempRoot = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-git-ignore-symlink-",
              });
              const vaultPath = path.join(tempRoot, "vault");
              const ignorePath = path.join(vaultPath, ".gitignore");
              const externalPath = path.join(tempRoot, "external.gitignore");
              const externalBytes = "external-rule\n";

              yield* initVaultFromTemplate({
                targetPath: vaultPath,
                initializeGit: false,
                yes: true,
              });
              yield* fs.writeFileString(externalPath, externalBytes);
              yield* fs.remove(ignorePath);
              yield* fs.symlink(externalPath, ignorePath);

              const repairFailure = yield* ensureSemanticIndexGitIgnore(vaultPath).pipe(
                Effect.flip,
              );
              const initFailure = yield* initVaultFromTemplate({
                targetPath: vaultPath,
                initializeGit: false,
                yes: true,
              }).pipe(Effect.flip);

              assert.instanceOf(repairFailure, VaultGitIgnoreError);
              assert.strictEqual(repairFailure.reason, "unsafe_symlink");
              assert.strictEqual(
                repairFailure.message,
                `Vault Git ignore file must not be a symlink: ${ignorePath}`,
              );
              assert.instanceOf(initFailure, VaultTemplateError);
              assert.strictEqual(initFailure.message, repairFailure.message);
              assert.strictEqual(yield* fs.readFileString(externalPath), externalBytes);
              assert.strictEqual(yield* fs.readLink(ignorePath), externalPath);
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("repairs a leading-space near-match and remains idempotent", () =>
    VaultGitIgnoreRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const vaultPath = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-git-ignore-leading-space-",
              });
              const ignorePath = path.join(vaultPath, ".gitignore");
              const indexPath = path.join(vaultPath, ".agentic-memory", "index");
              const existing = ` ${SEMANTIC_INDEX_GITIGNORE_ENTRY}\n`;

              yield* initializeGitRepository(vaultPath);
              yield* fs.makeDirectory(indexPath, { recursive: true });
              yield* fs.writeFileString(path.join(indexPath, "recall.db"), "index");
              yield* fs.writeFileString(ignorePath, existing);

              const first = yield* ensureSemanticIndexGitIgnore(vaultPath);
              const second = yield* ensureSemanticIndexGitIgnore(vaultPath);
              const repaired = yield* fs.readFileString(ignorePath);

              assert.isTrue(first);
              assert.isFalse(second);
              assert.strictEqual(repaired, `${existing}${SEMANTIC_INDEX_GITIGNORE_ENTRY}\n`);
              yield* assertGitIgnored(vaultPath, ".agentic-memory/index/recall.db");
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("preserves an escaped trailing-space rule byte-for-byte", () =>
    VaultGitIgnoreRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const vaultPath = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-git-ignore-trailing-space-",
              });
              const ignorePath = path.join(vaultPath, ".gitignore");
              const ignoredFile = "ignored-file ";
              const existing = "ignored-file\\ ";

              yield* initializeGitRepository(vaultPath);
              yield* fs.writeFileString(path.join(vaultPath, ignoredFile), "ignored");
              yield* fs.writeFileString(ignorePath, existing);
              yield* assertGitIgnored(vaultPath, ignoredFile);

              const first = yield* ensureSemanticIndexGitIgnore(vaultPath);
              const second = yield* ensureSemanticIndexGitIgnore(vaultPath);
              const repaired = yield* fs.readFileString(ignorePath);

              assert.isTrue(first);
              assert.isFalse(second);
              assert.strictEqual(repaired, `${existing}\n${SEMANTIC_INDEX_GITIGNORE_ENTRY}\n`);
              assert.strictEqual(
                new TextEncoder().encode(repaired).slice(0, existing.length).length,
                existing.length,
              );
              assert.strictEqual(repaired.slice(0, existing.length), existing);
              yield* assertGitIgnored(vaultPath, ignoredFile);
            }),
          ),
          context,
        ),
      ),
    ),
  );
});
