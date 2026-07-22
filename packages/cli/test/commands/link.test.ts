import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory link command", () => {
  afterAll(dispose);

  it.effect("emits JSON command errors to stdout", () =>
    withCliRuntime(
      runCapturedEffect(["link", "--vault", "relative", "--project", "example-project", "--json"]),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"status":"failed"');
        assert.include(output.stdout, '"code":"InvalidVault"');
        assert.include(output.stderr, "InvalidVault");
      }),
    ),
  );
  it.effect("rejects linking vaults that are missing session-capture guidance", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-link-missing-capture-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          const configPath = path.join(projectRoot, ".agentic-memory-link", "config.json");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(projectRoot, { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );

          const output = yield* runCapturedEffect([
            "link",
            "--vault",
            vaultPath,
            "--project",
            "example-project",
            "--project-root",
            projectRoot,
            "--json",
          ]);
          const configExists = yield* fs.exists(configPath);

          return { configExists, output };
        }),
      ),
    ).pipe(
      Effect.map(({ configExists, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"InvalidVault"');
        assert.include(output.stdout, "session-capture.md");
        assert.isFalse(configExists);
      }),
    ),
  );
  it.effect("does not mutate the vault when local link config creation fails", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-link-atomicity-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          const memoryPath = path.join(vaultPath, "MEMORY.md");
          const projectFilePath = path.join(vaultPath, "projects", "example-project.md");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(projectRoot, { recursive: true });
          yield* fs.writeFileString(memoryPath, "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
            "session-capture contract",
          );
          yield* fs.chmod(projectRoot, 0o555);

          const output = yield* runCapturedEffect([
            "link",
            "--vault",
            vaultPath,
            "--project",
            "example-project",
            "--project-root",
            projectRoot,
            "--json",
          ]).pipe(Effect.ensuring(fs.chmod(projectRoot, 0o755).pipe(Effect.orDie)));

          const memoryContents = yield* fs.readFileString(memoryPath);
          const projectFileExists = yield* fs.exists(projectFilePath);

          return { memoryContents, output, projectFileExists };
        }),
      ),
    ).pipe(
      Effect.map(({ memoryContents, output, projectFileExists }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"WriteConfigFailed"');
        assert.isFalse(projectFileExists);
        assert.notInclude(memoryContents, "[[projects/example-project]]");
      }),
    ),
  );

  it.effect("does not leave a local link behind when vault setup fails", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-link-rollback-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          const configPath = path.join(projectRoot, ".agentic-memory-link", "config.json");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(projectRoot, { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
            "session-capture contract",
          );
          yield* fs.chmod(path.join(vaultPath, "projects"), 0o555);

          const output = yield* runCapturedEffect([
            "link",
            "--vault",
            vaultPath,
            "--project",
            "example-project",
            "--project-root",
            projectRoot,
            "--yes",
            "--json",
          ]).pipe(
            Effect.ensuring(fs.chmod(path.join(vaultPath, "projects"), 0o755).pipe(Effect.ignore)),
          );
          const configExists = yield* fs.exists(configPath);

          return { configExists, output };
        }),
      ),
    ).pipe(
      Effect.map(({ configExists, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"ProjectFileFailed"');
        assert.isFalse(configExists);
      }),
    ),
  );
});
