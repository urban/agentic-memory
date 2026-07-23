import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();
const removedProjectDirectoryFlag = `--${["project", "root"].join("-")}`;

describe("agentic-memory command help", () => {
  afterAll(dispose);

  it.effect("exposes the effective-directory flag without the removed compatibility flag", () =>
    withCliRuntime(
      Effect.forEach(
        [
          ["--help"],
          ["link", "--help"],
          ["status", "--help"],
          ["steward-context", "--help"],
          ["run-steward", "--help"],
        ],
        (args) =>
          runCapturedEffect(args).pipe(
            Effect.map((output) => {
              assert.strictEqual(output.exitCode, 0);
              assert.include(output.stdout, "--directory, -C string");
              assert.notInclude(output.stdout, removedProjectDirectoryFlag);
              assert.strictEqual(output.stderr, "");
            }),
          ),
      ),
    ),
  );
});
