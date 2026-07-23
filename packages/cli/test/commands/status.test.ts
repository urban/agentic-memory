import {
  CliFailureResultJson,
  decodeStatusCommandResultJson,
  decodeVaultStatusResultJson,
} from "@urban/agentic-memory-core/cli/CliResults";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { afterAll } from "vitest";
import { fakeFileInfo, makeCliTestRuntime } from "../cli-test-support.ts";

const decodeCliFailureResultJson = Schema.decodeUnknownEffect(CliFailureResultJson);
const decodeVaultReadiness = (json: string) =>
  decodeVaultStatusResultJson(json).pipe(Effect.map((result) => result.readiness));
const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory status command", () => {
  afterAll(dispose);

  it.effect("reports an unconfigured exact directory without searching ancestors", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "agentic-memory-cli-" });
          const json = yield* runCapturedEffect(["-C", projectRoot, "status", "--json"]);
          const human = yield* runCapturedEffect(["-C", projectRoot, "status"]);
          return { human, json };
        }),
      ),
    ).pipe(
      Effect.map(({ human, json }) => {
        assert.strictEqual(json.exitCode, 0);
        assert.include(json.stdout, '"_tag":"unconfigured"');
        assert.include(json.stdout, '"version":1');
        assert.include(json.stdout, ".agentic-memory-link/config.json");
        assert.strictEqual(json.stderr, "");
        assert.strictEqual(human.exitCode, 0);
        assert.include(human.stdout, "Agentic Memory status: unconfigured");
      }),
    ),
  );

  it.effect("detects a vault from the exact effective directory", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-context-vault-",
          });
          yield* runCapturedEffect(["init", vaultPath, "--json"]);
          const output = yield* runCapturedEffect(["-C", vaultPath, "status", "--json"]);
          const result = yield* decodeStatusCommandResultJson(output.stdout);

          assert.strictEqual(output.exitCode, 0);
          assert.strictEqual(result._tag, "vault");
          if (result._tag === "vault") {
            assert.strictEqual(result.directory, yield* fs.realPath(vaultPath));
            assert.strictEqual(result.readiness.status, "not_ready");
          }
          assert.strictEqual(output.stderr, "");
        }),
      ),
    ),
  );

  it.effect("does not inherit a linked-project context from an ancestor", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const parent = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-exact-",
          });
          const child = path.join(parent, "child");
          yield* fs.makeDirectory(path.join(parent, ".agentic-memory-link"), { recursive: true });
          yield* fs.makeDirectory(child);
          yield* fs.writeFileString(
            path.join(parent, ".agentic-memory-link", "config.json"),
            '{"version":1,"vaultPath":"/vault","projectSlug":"example-project"}\n',
          );

          const output = yield* runCapturedEffect(["-C", child, "status", "--json"]);
          const result = yield* decodeStatusCommandResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 0);
          assert.strictEqual(result._tag, "unconfigured");
        }),
      ),
    ),
  );

  it.effect("surfaces missing session-capture guidance in unhealthy status details", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-missing-capture-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(projectRoot, ".agentic-memory-link"), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(projectRoot, ".agentic-memory-link", "config.json"),
            `{"version":1,"vaultPath":"${vaultPath}","projectSlug":"example-project"}\n`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            `# Memory

## Projects

- [[projects/example-project]] — example-project.
`,
          );
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "example-project.md"),
            "# example-project\n",
          );

          return yield* runCapturedEffect(["-C", projectRoot, "status", "--json"]);
        }),
      ),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 0);
        assert.include(output.stdout, '"_tag":"linked-project"');
        assert.include(output.stdout, '"status":"unhealthy"');
        assert.include(output.stdout, '"sessionCaptureInstructionsExists":false');
        assert.include(output.stdout, '"semanticReadiness"');
      }),
    ),
  );

  it.effect("includes project-route health and linked-vault semantic readiness", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-linked-readiness-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          yield* runCapturedEffect(["init", vaultPath, "--json"]);
          yield* fs.makeDirectory(path.join(projectRoot, ".agentic-memory-link"), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(projectRoot, ".agentic-memory-link", "config.json"),
            `{"version":1,"vaultPath":"${vaultPath}","projectSlug":"example-project"}\n`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "example-project.md"),
            "# Example project\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            "# Memory\n\n## Projects\n\n- [[projects/example-project]] — example-project.\n",
          );

          const output = yield* runCapturedEffect(["-C", projectRoot, "status", "--json"]);
          const result = yield* decodeStatusCommandResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 0);
          assert.strictEqual(result._tag, "linked-project");
          if (result._tag === "linked-project") {
            assert.strictEqual(result.status, "healthy");
            assert.strictEqual(result.inspection._tag, "valid-link");
            if (result.inspection._tag === "valid-link") {
              assert.isTrue(result.inspection.projectRoute.healthy);
              assert.strictEqual(result.inspection.semanticReadiness.status, "not_ready");
              assert.isFalse(result.inspection.semanticReadiness.recallReady);
            }
          }
        }),
      ),
    ),
  );

  it.effect("reports invalid link configuration instead of falling back to a vault", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-invalid-link-vault-",
          });
          yield* runCapturedEffect(["init", vaultPath, "--json"]);
          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory-link"));
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory-link", "config.json"),
            "not json\n",
          );

          const output = yield* runCapturedEffect(["-C", vaultPath, "status", "--json"]);
          const result = yield* decodeStatusCommandResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 0);
          assert.strictEqual(result._tag, "linked-project");
          if (result._tag === "linked-project") {
            assert.strictEqual(result.inspection._tag, "invalid-link");
          }
        }),
      ),
    ),
  );

  it.effect("fails when the exact directory is both a vault and a linked project", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-ambiguous-",
          });
          yield* runCapturedEffect(["init", vaultPath, "--json"]);
          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory-link"));
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory-link", "config.json"),
            `{"version":1,"vaultPath":"${vaultPath}","projectSlug":"example-project"}\n`,
          );

          const output = yield* runCapturedEffect(["-C", vaultPath, "status", "--json"]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 2);
          assert.strictEqual(failure.error.code, "AmbiguousStatusContext");
        }),
      ),
    ),
  );

  it.effect("reports vault semantic readiness with observational exit semantics", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-vault-",
          });
          yield* runCapturedEffect(["init", vaultPath, "--json"]);
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n\nRoot.\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n\nOwner.\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "fact.md"),
            "# Fact\n\nA durable fact.\n",
          );
          const missingOutput = yield* runCapturedEffect([
            "status",
            "--vault",
            vaultPath,
            "--json",
          ]);
          const missing = yield* decodeVaultReadiness(missingOutput.stdout);
          assert.strictEqual(missingOutput.exitCode, 0);
          assert.strictEqual(missing.status, "not_ready");
          assert.strictEqual(missing.index.status, "missing");
          assert.strictEqual(missing.index.newFiles, 3);
          assert.isFalse(missing.recallReady);
          assert.strictEqual(missingOutput.stderr, "");

          yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const readyOutput = yield* runCapturedEffect(["status", "--vault", vaultPath, "--json"]);
          const ready = yield* decodeVaultReadiness(readyOutput.stdout);
          assert.strictEqual(readyOutput.exitCode, 0);
          assert.strictEqual(ready.status, "ready");
          assert.strictEqual(ready.index.status, "current");
          assert.isTrue(ready.recallReady);

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "fact.md"),
            "# Fact\n\nA changed durable fact.\n",
          );
          const staleOutput = yield* runCapturedEffect(["status", "--vault", vaultPath]);
          assert.strictEqual(staleOutput.exitCode, 0);
          assert.include(staleOutput.stdout, "Agentic Memory vault status: not_ready");
          assert.include(
            staleOutput.stdout,
            "Index: stale (0 new, 1 changed, 0 deleted, 2 unchanged)",
          );
          assert.include(staleOutput.stdout, "Recall ready: no");
          assert.strictEqual(staleOutput.stderr, "");
        }),
      ),
    ),
  );

  it.effect("resolves a relative explicit vault from -C and reports invalid status as data", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-directory-",
          });
          const effectiveDirectory = yield* fs.realPath(tempRoot);
          const output = yield* runCapturedEffect([
            "-C",
            tempRoot,
            "status",
            "--vault",
            "relative/vault",
            "--json",
          ]);
          const result = yield* decodeVaultReadiness(output.stdout);
          return {
            output,
            result,
            vaultPath: path.join(effectiveDirectory, "relative", "vault"),
          };
        }),
      ),
    ).pipe(
      Effect.map(({ output, result, vaultPath }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(result.status, "invalid");
        assert.strictEqual(result.vault.status, "invalid");
        assert.strictEqual(result.vault.path, vaultPath);
        assert.strictEqual(result.index.status, "invalid");
        assert.isFalse(result.recallReady);
        assert.strictEqual(output.stderr, "");
      }),
    ),
  );

  it.effect("reports incomplete required vault layouts as invalid data", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-incomplete-layout-",
          });
          const missingEntries = [
            { vaultName: "missing-maps", relativePath: "maps", warning: "maps/" },
            {
              vaultName: "missing-note-template",
              relativePath: path.join(".agentic-memory", "templates", "note.md"),
              warning: ".agentic-memory/templates/note.md",
            },
          ];

          for (const entry of missingEntries) {
            const vaultPath = path.join(tempRoot, entry.vaultName);
            const initOutput = yield* runCapturedEffect(["init", vaultPath, "--json"]);
            assert.strictEqual(initOutput.exitCode, 0);
            yield* fs.remove(path.join(vaultPath, entry.relativePath), {
              recursive: entry.relativePath === "maps",
            });

            const output = yield* runCapturedEffect(["status", "--vault", vaultPath, "--json"]);
            const result = yield* decodeVaultReadiness(output.stdout);

            assert.strictEqual(output.exitCode, 0);
            assert.strictEqual(result.status, "invalid");
            assert.strictEqual(result.vault.status, "invalid");
            assert.strictEqual(result.model.status, "not_checked");
            assert.strictEqual(result.index.status, "invalid");
            assert.include(result.warnings.join(" "), entry.warning);
            assert.strictEqual(output.stderr, "");
          }
        }),
      ),
    ),
  );

  it.effect("reports wrong required vault entry types as invalid data", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-wrong-entry-type-",
          });
          const cases = [
            {
              vaultName: "file-as-directory",
              relativePath: "AGENTS.md",
              warning: "AGENTS.md must be a file",
              replace: (entryPath: string) =>
                fs.remove(entryPath).pipe(Effect.andThen(fs.makeDirectory(entryPath))),
            },
            {
              vaultName: "directory-as-file",
              relativePath: "maps",
              warning: "maps/ must be a directory",
              replace: (entryPath: string) =>
                fs
                  .remove(entryPath, { recursive: true })
                  .pipe(Effect.andThen(fs.writeFileString(entryPath, "not a directory\n"))),
            },
          ];

          for (const entry of cases) {
            const vaultPath = path.join(tempRoot, entry.vaultName);
            const initOutput = yield* runCapturedEffect(["init", vaultPath, "--json"]);
            assert.strictEqual(initOutput.exitCode, 0);
            yield* entry.replace(path.join(vaultPath, entry.relativePath));

            const output = yield* runCapturedEffect(["status", "--vault", vaultPath, "--json"]);
            const result = yield* decodeVaultReadiness(output.stdout);

            assert.strictEqual(output.exitCode, 0);
            assert.strictEqual(result.status, "invalid");
            assert.strictEqual(result.vault.status, "invalid");
            assert.strictEqual(result.model.status, "not_checked");
            assert.strictEqual(result.index.status, "invalid");
            assert.include(result.warnings.join(" "), entry.warning);
            assert.strictEqual(output.stderr, "");
          }
        }),
      ),
    ),
  );

  it.effect("reports a missing vault control plane as invalid data with exit code zero", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-invalid-vault-",
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "AGENTS.md"), "# Agents\n");
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");

          const output = yield* runCapturedEffect(["status", "--vault", vaultPath, "--json"]);
          const result = yield* decodeVaultReadiness(output.stdout);

          assert.strictEqual(output.exitCode, 0);
          assert.strictEqual(result.status, "invalid");
          assert.strictEqual(result.vault.status, "invalid");
          assert.strictEqual(result.model.status, "not_checked");
          assert.strictEqual(result.index.status, "invalid");
          assert.isFalse(result.recallReady);
          assert.include(result.warnings.join(" "), ".agentic-memory");
          assert.strictEqual(output.stderr, "");
        }),
      ),
    ),
  );

  it.effect("reports missing vault structure as invalid data with exit code zero", () => {
    const notFound = PlatformError.systemError({
      _tag: "NotFound",
      module: "FileSystem",
      method: "realPath",
      pathOrDescriptor: "/missing-vault",
    });
    const missingInventory = FileSystem.makeNoop({
      realPath: (path) => (path === process.cwd() ? Effect.succeed(path) : Effect.fail(notFound)),
      stat: () => Effect.succeed(fakeFileInfo("Directory")),
    });

    return withCliRuntime(
      runCapturedEffect(["status", "--vault", "/missing-vault", "--json"]).pipe(
        Effect.flatMap((output) =>
          decodeVaultReadiness(output.stdout).pipe(
            Effect.map((result) => {
              assert.strictEqual(output.exitCode, 0);
              assert.strictEqual(result.status, "invalid");
              assert.strictEqual(result.vault.status, "invalid");
              assert.strictEqual(result.model.status, "not_checked");
              assert.strictEqual(output.stderr, "");
            }),
          ),
        ),
        Effect.provideService(FileSystem.FileSystem, missingInventory),
      ),
    );
  });

  it.effect("reports disappearing vault entries as invalid data with exit code zero", () => {
    const notFound = PlatformError.systemError({
      _tag: "NotFound",
      module: "FileSystem",
      method: "stat",
      pathOrDescriptor: "/vault/AGENTS.md",
    });
    const disappearingEntry = FileSystem.makeNoop({
      exists: () => Effect.succeed(true),
      realPath: (path) => Effect.succeed(path),
      stat: (path) =>
        path === process.cwd() ? Effect.succeed(fakeFileInfo("Directory")) : Effect.fail(notFound),
    });

    return withCliRuntime(
      runCapturedEffect(["status", "--vault", "/vault", "--json"]).pipe(
        Effect.flatMap((output) =>
          decodeVaultReadiness(output.stdout).pipe(
            Effect.map((result) => {
              assert.strictEqual(output.exitCode, 0);
              assert.strictEqual(result.status, "invalid");
              assert.strictEqual(result.vault.status, "invalid");
              assert.strictEqual(result.model.status, "not_checked");
              assert.strictEqual(result.index.status, "invalid");
              assert.include(result.warnings.join(" "), "AGENTS.md");
              assert.strictEqual(output.stderr, "");
            }),
          ),
        ),
        Effect.provideService(FileSystem.FileSystem, disappearingEntry),
      ),
    );
  });

  it.effect("returns nonzero when a required vault entry cannot be inspected", () => {
    const permissionDenied = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "stat",
      pathOrDescriptor: "/vault/AGENTS.md",
    });
    const inaccessibleEntry = FileSystem.makeNoop({
      exists: () => Effect.succeed(true),
      realPath: (path) => Effect.succeed(path),
      stat: (path) =>
        path === process.cwd()
          ? Effect.succeed(fakeFileInfo("Directory"))
          : Effect.fail(permissionDenied),
    });

    return withCliRuntime(
      runCapturedEffect(["status", "--vault", "/vault", "--json"]).pipe(
        Effect.flatMap((output) =>
          decodeCliFailureResultJson(output.stdout).pipe(
            Effect.map((failure) => {
              assert.strictEqual(output.exitCode, 1);
              assert.strictEqual(failure.status, "failed");
              assert.strictEqual(failure.error.code, "IndexReadFailed");
              assert.include(output.stderr, "IndexReadFailed");
            }),
          ),
        ),
        Effect.provideService(FileSystem.FileSystem, inaccessibleEntry),
      ),
    );
  });

  it.effect("returns nonzero when managed inventory cannot be read", () => {
    const permissionDenied = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readDirectory",
      pathOrDescriptor: "/vault",
    });
    const requiredDirectorySuffixes = [
      "/maps",
      "/notes",
      "/people",
      "/projects",
      "/records",
      "/sources",
    ];
    const failingInventory = FileSystem.makeNoop({
      exists: () => Effect.succeed(true),
      stat: (entryPath) =>
        Effect.succeed(
          fakeFileInfo(
            entryPath === process.cwd() ||
              requiredDirectorySuffixes.some((suffix) => entryPath.endsWith(suffix))
              ? "Directory"
              : "File",
          ),
        ),
      realPath: (path) => Effect.succeed(path),
      readDirectory: () => Effect.fail(permissionDenied),
    });

    return withCliRuntime(
      runCapturedEffect(["status", "--vault", "/vault", "--json"]).pipe(
        Effect.flatMap((output) =>
          decodeCliFailureResultJson(output.stdout).pipe(
            Effect.map((failure) => {
              assert.strictEqual(output.exitCode, 1);
              assert.strictEqual(failure.status, "failed");
              assert.strictEqual(failure.error.code, "IndexReadFailed");
              assert.include(output.stderr, "IndexReadFailed");
            }),
          ),
        ),
        Effect.provideService(FileSystem.FileSystem, failingInventory),
      ),
    );
  });

  it.effect("keeps vault status execution failures nonzero", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-failure-",
          });
          const initOutput = yield* runCapturedEffect(["init", vaultPath, "--json"]);
          assert.strictEqual(initOutput.exitCode, 0);
          const indexDirectory = path.join(vaultPath, ".agentic-memory", "index");
          yield* fs.makeDirectory(indexDirectory, { recursive: true });
          yield* fs.writeFileString(path.join(indexDirectory, "recall.db"), "not a database");

          const output = yield* runCapturedEffect(["status", "--vault", vaultPath, "--json"]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.status, "failed");
          assert.strictEqual(failure.error.code, "IndexReadFailed");
          assert.include(output.stderr, "IndexReadFailed");
        }),
      ),
    ),
  );
});
