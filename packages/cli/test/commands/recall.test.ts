import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { makeCliTestRuntime } from "../cli-test-support.ts";

const recallFixtureVaultPath = fileURLToPath(
  new URL("../../../core/test/fixtures/retrieval/basic-vault/", import.meta.url),
);
const recallQuestion =
  "In Alpha Product, what latency budget should I follow, and how should I present options back to Urban?";
const unknownRecallQuestion = "What launch window did Gamma Project choose?";
const sourceVerificationQuestion =
  "What source verification evidence did the Alpha Product responsiveness trial record for the latency decision?";
const { dispose, runCapturedEffect, withCliRuntime } = makeCliTestRuntime();

describe("agentic-memory recall command", () => {
  afterAll(dispose);

  it.effect("can import the public recall contract from core exports", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeRecallSuccessJson(
        '{"status":"answered","question":"What should I follow?","answer":"Follow the contract.","warnings":[]}',
      );

      assert.strictEqual(decoded.status, "answered");
      assert.strictEqual(decoded.answer, "Follow the contract.");
    }),
  );
  it.effect("emits public recall success JSON for answered recall", () =>
    withCliRuntime(
      runCapturedEffect([
        "recall",
        recallQuestion,
        "--vault",
        recallFixtureVaultPath,
        "--json",
      ]).pipe(
        Effect.flatMap((output) =>
          decodeRecallSuccessJson(output.stdout.trim()).pipe(
            Effect.map((decoded) => ({
              decoded,
              output,
            })),
          ),
        ),
      ),
    ).pipe(
      Effect.map(({ decoded, output }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(decoded.status, "answered");
        assert.strictEqual(decoded.question, recallQuestion);
        assert.include(decoded.answer, "200ms p95");
        assert.include(decoded.answer, "stack-ranked");
        assert.include(decoded.answer, "capital-letter");
        assert.notInclude(decoded.answer, "5 second batch retry window");
        assert.deepStrictEqual(decoded.warnings, []);
      }),
    ),
  );

  it.effect("passes --include-sources into core recall without changing public JSON fields", () =>
    withCliRuntime(
      runCapturedEffect([
        "recall",
        sourceVerificationQuestion,
        "--vault",
        recallFixtureVaultPath,
        "--include-sources",
        "--json",
      ]).pipe(
        Effect.flatMap((output) =>
          decodeRecallSuccessJson(output.stdout.trim()).pipe(
            Effect.map((decoded) => ({
              decoded,
              output,
            })),
          ),
        ),
      ),
    ).pipe(
      Effect.map(({ decoded, output }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(decoded.status, "answered");
        assert.include(decoded.answer, "180ms observed p95 verification threshold");
        assert.notInclude(decoded.answer, "sources/");
        assert.notInclude(decoded.answer, "[[");
        assert.notInclude(decoded.answer, "alpha-trial-raw.md");
        assert.deepStrictEqual(Object.keys(decoded).toSorted(), [
          "answer",
          "question",
          "status",
          "warnings",
        ]);
      }),
    ),
  );

  it.effect("emits public recall success JSON for not_found recall", () =>
    withCliRuntime(
      runCapturedEffect([
        "recall",
        unknownRecallQuestion,
        "--vault",
        recallFixtureVaultPath,
        "--json",
      ]).pipe(
        Effect.flatMap((output) =>
          decodeRecallSuccessJson(output.stdout.trim()).pipe(
            Effect.map((decoded) => ({
              decoded,
              output,
            })),
          ),
        ),
      ),
    ).pipe(
      Effect.map(({ decoded, output }) => {
        assert.strictEqual(output.exitCode, 0);
        assert.strictEqual(output.stderr, "");
        assert.strictEqual(decoded.status, "not_found");
        assert.strictEqual(decoded.question, unknownRecallQuestion);
        assert.include(decoded.answer, "I don't know");
        assert.notInclude(decoded.answer, "200ms p95");
        assert.notInclude(decoded.answer, "5 second batch retry window");
        assert.deepStrictEqual(decoded.warnings, []);
      }),
    ),
  );

  it.effect("reports a missing recall question with existing positional-argument wording", () =>
    withCliRuntime(runCapturedEffect(["recall", "--vault", recallFixtureVaultPath, "--json"])).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, "agentic-memory recall [flags] <question>");
        assert.include(output.stderr, "Missing required argument: question");
      }),
    ),
  );

  it.effect("reports a missing recall vault flag with existing required-flag wording", () =>
    withCliRuntime(runCapturedEffect(["recall", recallQuestion, "--json"])).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, "agentic-memory recall [flags] <question>");
        assert.include(output.stderr, "Missing required flag");
        assert.include(output.stderr, "--vault");
      }),
    ),
  );
});
