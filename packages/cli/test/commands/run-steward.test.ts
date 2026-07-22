import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory run-steward command", () => {
  afterAll(dispose);

  it.effect("rejects non-positive steward timeouts with the existing CLI validation", () =>
    withCliRuntime(
      runCapturedEffect([
        "run-steward",
        "--payload",
        "-",
        "--project-root",
        ".",
        "--timeout-ms",
        "0",
      ]),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stderr, "Invalid value for flag --timeout-ms");
        assert.include(output.stderr, "Expected: positive integer");
      }),
    ),
  );
});
