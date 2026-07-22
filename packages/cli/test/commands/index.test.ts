import {
  CliFailureResultJson,
  decodeSemanticIndexResultJson,
} from "@urban/agentic-memory-core/cli/CliResults";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const decodeCliFailureResultJson = Schema.decodeUnknownEffect(CliFailureResultJson);
const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory index command", () => {
  afterAll(dispose);

  it.effect("resolves a relative vault path from the shared -C directory", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-index-directory-",
          });
          const effectiveDirectory = yield* fs.realPath(tempRoot);
          const vaultPath = path.join(effectiveDirectory, "vault");
          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          const output = yield* runCapturedEffect([
            "-C",
            tempRoot,
            "index",
            "--vault",
            "vault",
            "--json",
          ]);
          const result = yield* decodeSemanticIndexResultJson(output.stdout);
          return { output, result, vaultPath };
        }),
      ),
    ).pipe(
      Effect.map(({ output, result, vaultPath }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(result.vaultPath, vaultPath);
      }),
    ),
  );

  it.effect("reports complete typed counts across the incremental index lifecycle", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-index-cli-",
          });
          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), { recursive: true });
          yield* fs.makeDirectory(path.join(vaultPath, "notes"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n\nRoot.\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n\nOwner.\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "fact.md"),
            "# Fact\n\nA durable fact.\n",
          );

          const indexedOutput = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const indexed = yield* decodeSemanticIndexResultJson(indexedOutput.stdout);
          assert.strictEqual(indexedOutput.exitCode, 0);
          assert.strictEqual(indexed.status, "indexed");
          assert.deepStrictEqual(indexed.files, {
            new: 3,
            changed: 0,
            deleted: 0,
            unchanged: 0,
          });
          assert.deepStrictEqual(indexed.chunks, { embedded: 3, removed: 0 });
          assert.strictEqual(indexedOutput.stderr, "");

          const currentOutput = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const current = yield* decodeSemanticIndexResultJson(currentOutput.stdout);
          assert.strictEqual(currentOutput.exitCode, 0);
          assert.strictEqual(current.status, "already_current");
          assert.deepStrictEqual(current.files, {
            new: 0,
            changed: 0,
            deleted: 0,
            unchanged: 3,
          });
          assert.deepStrictEqual(current.chunks, { embedded: 0, removed: 0 });
          assert.strictEqual(currentOutput.stderr, "");

          const addedPath = path.join(vaultPath, "notes", "added.md");
          yield* fs.writeFileString(addedPath, "# Added\n\nA newly durable fact.\n");
          const addedOutput = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const added = yield* decodeSemanticIndexResultJson(addedOutput.stdout);
          assert.strictEqual(addedOutput.exitCode, 0);
          assert.strictEqual(added.status, "indexed");
          assert.deepStrictEqual(added.files, {
            new: 1,
            changed: 0,
            deleted: 0,
            unchanged: 3,
          });
          assert.deepStrictEqual(added.chunks, { embedded: 1, removed: 0 });
          assert.strictEqual(addedOutput.stderr, "");

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "fact.md"),
            "# Fact\n\nA changed durable fact.\n",
          );
          const changedOutput = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const changed = yield* decodeSemanticIndexResultJson(changedOutput.stdout);
          assert.strictEqual(changedOutput.exitCode, 0);
          assert.strictEqual(changed.status, "indexed");
          assert.deepStrictEqual(changed.files, {
            new: 0,
            changed: 1,
            deleted: 0,
            unchanged: 3,
          });
          assert.deepStrictEqual(changed.chunks, { embedded: 1, removed: 1 });
          assert.strictEqual(changedOutput.stderr, "");

          yield* fs.remove(addedPath);
          const removedOutput = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const removed = yield* decodeSemanticIndexResultJson(removedOutput.stdout);
          assert.strictEqual(removedOutput.exitCode, 0);
          assert.strictEqual(removed.status, "indexed");
          assert.deepStrictEqual(removed.files, {
            new: 0,
            changed: 0,
            deleted: 1,
            unchanged: 3,
          });
          assert.deepStrictEqual(removed.chunks, { embedded: 0, removed: 1 });
          assert.strictEqual(removedOutput.stderr, "");

          const deletedOutput = yield* runCapturedEffect([
            "index",
            "--vault",
            vaultPath,
            "--delete",
            "--json",
          ]);
          const deleted = yield* decodeSemanticIndexResultJson(deletedOutput.stdout);
          assert.strictEqual(deletedOutput.exitCode, 0);
          assert.strictEqual(deleted.status, "deleted");
          assert.deepStrictEqual(deleted.files, {
            new: 0,
            changed: 0,
            deleted: 0,
            unchanged: 0,
          });
          assert.deepStrictEqual(deleted.chunks, { embedded: 0, removed: 0 });
          assert.strictEqual(deletedOutput.stderr, "");
          assert.isFalse(yield* fs.exists(path.join(vaultPath, ".agentic-memory", "index")));

          const absentOutput = yield* runCapturedEffect([
            "index",
            "--vault",
            vaultPath,
            "--delete",
            "--json",
          ]);
          const absent = yield* decodeSemanticIndexResultJson(absentOutput.stdout);
          assert.strictEqual(absentOutput.exitCode, 0);
          assert.strictEqual(absent.status, "already_absent");
          assert.deepStrictEqual(absent.files, {
            new: 0,
            changed: 0,
            deleted: 0,
            unchanged: 0,
          });
          assert.deepStrictEqual(absent.chunks, { embedded: 0, removed: 0 });
          assert.strictEqual(absentOutput.stderr, "");
          assert.isTrue(yield* fs.exists(path.join(vaultPath, "MEMORY.md")));
        }),
      ),
    ),
  );

  it.effect("maps a busy semantic index to the precise public CLI failure", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-index-busy-cli-",
          });
          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "index.lock"), {
            recursive: true,
          });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n\nRoot.\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n\nOwner.\n");

          const output = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.status, "failed");
          assert.strictEqual(failure.error.code, "IndexBusy");
          assert.include(failure.error.message, "active operation");
          assert.deepStrictEqual(failure.warnings, []);
          assert.include(output.stderr, "IndexBusy");
        }),
      ),
    ),
  );

  it.effect("maps an incompatible semantic index to delete-then-index CLI guidance", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-index-incompatible-cli-",
          });
          const indexDirectory = path.join(vaultPath, ".agentic-memory", "index");
          yield* fs.makeDirectory(indexDirectory, { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n\nRoot.\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n\nOwner.\n");
          yield* fs.writeFileString(path.join(indexDirectory, "recall.db"), "incompatible");

          const output = yield* runCapturedEffect(["index", "--vault", vaultPath, "--json"]);
          const failure = yield* decodeCliFailureResultJson(output.stdout);
          assert.strictEqual(output.exitCode, 1);
          assert.strictEqual(failure.status, "failed");
          assert.strictEqual(failure.error.code, "IncompatibleIndex");
          assert.include(failure.error.message, `index --vault ${vaultPath} --delete`);
          assert.include(failure.error.message, "then index again");
          assert.deepStrictEqual(failure.warnings, []);
          assert.include(output.stderr, "IncompatibleIndex");
          assert.include(output.stderr, "--delete");
        }),
      ),
    ),
  );
});
