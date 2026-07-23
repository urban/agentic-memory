import { decodeLinkConfig, encodeLinkConfigJson } from "@urban/agentic-memory-core/link/LinkConfig";
import { decodeStewardContextResultJson } from "@urban/agentic-memory-core/steward/StewardContext";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory steward-context command", () => {
  afterAll(dispose);

  it.effect("resolves a relative payload and linked target from -C", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-steward-context-",
          });
          const projectRoot = path.join(tempRoot, "project");
          const vaultPath = path.join(tempRoot, "vault");
          yield* fs.makeDirectory(path.join(projectRoot, ".agentic-memory-link"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), { recursive: true });
          yield* fs.writeFileString(
            path.join(projectRoot, "payload.json"),
            '{"version":1,"projectSlug":"example-project","messages":[{"role":"user","text":"hello"}]}',
          );
          const linkConfig = yield* decodeLinkConfig({
            version: 1,
            vaultPath,
            projectSlug: "example-project",
          });
          yield* fs.writeFileString(
            path.join(projectRoot, ".agentic-memory-link", "config.json"),
            yield* encodeLinkConfigJson(linkConfig),
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            "# Memory\n\n## Projects\n\n- [[projects/example-project]] — example-project.\n",
          );
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "# Outside vault\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
            "# Session capture\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "example-project.md"),
            "# Example project\n",
          );

          const output = yield* runCapturedEffect([
            "-C",
            projectRoot,
            "steward-context",
            "--payload",
            "payload.json",
            "--json",
          ]);
          const result = yield* decodeStewardContextResultJson(output.stdout);

          return { output, result, vaultPath };
        }),
      ),
    ).pipe(
      Effect.map(({ output, result, vaultPath }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(result.status, "ready");
        assert.strictEqual(result.vault.path, vaultPath);
        assert.strictEqual(result.payload.projectSlug, "example-project");
      }),
    ),
  );
});
