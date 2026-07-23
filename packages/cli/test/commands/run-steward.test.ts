import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory run-steward command", () => {
  afterAll(dispose);

  it.effect("rejects non-positive steward timeouts with the existing CLI validation", () =>
    withCliRuntime(
      runCapturedEffect(["-C", ".", "run-steward", "--payload", "-", "--timeout-ms", "0"]),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stderr, "Invalid value for flag --timeout-ms");
        assert.include(output.stderr, "Expected: positive integer");
      }),
    ),
  );

  it.effect.each([
    {
      name: "empty provider",
      args: ["--provider", " "],
      expected: "selector containing non-whitespace content",
    },
    {
      name: "empty model",
      args: ["--model", "\t"],
      expected: "selector containing non-whitespace content",
    },
    {
      name: "unsupported thinking level",
      args: ["--thinking", "ultra"],
      expected: "off, minimal, low, medium, high, xhigh, or max",
    },
  ])("rejects $name before Steward context construction", ({ args, expected }) =>
    withCliRuntime(runCapturedEffect(["-C", ".", "run-steward", "--payload", "-", ...args])).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stderr, "Invalid value for flag");
        assert.include(output.stderr, expected);
        assert.notInclude(output.stderr, "MissingLinkConfig");
      }),
    ),
  );

  it.effect("resolves a relative payload and linked target from -C", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-run-steward-context-",
          });
          yield* fs.writeFileString(
            `${projectRoot}/payload.json`,
            '{"version":1,"projectSlug":"example-project","messages":[{"role":"user","text":"hello"}]}',
          );

          return yield* runCapturedEffect([
            "-C",
            projectRoot,
            "run-steward",
            "--payload",
            "payload.json",
            "--json",
          ]);
        }),
      ),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"MissingLinkConfig"');
        assert.include(output.stdout, ".agentic-memory-link/config.json");
      }),
    ),
  );
});
