import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { decodeSemanticStackProbeVaultStatus } from "../scripts/SemanticStackProbeStatus.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

describe("semantic stack probe status", () => {
  it.effect("decodes the current vault status contract", () =>
    Effect.gen(function* () {
      const status = yield* decodeSemanticStackProbeVaultStatus(
        encodeJson({
          _tag: "vault",
          version: 2,
          status: "ready",
          directory: "/tmp/vault",
          semanticReadiness: {
            status: "ready",
            vault: { status: "healthy", path: "/tmp/vault" },
            model: { status: "available", id: "embeddinggemma-300M-Q8_0" },
            index: {
              status: "current",
              newFiles: 0,
              changedFiles: 0,
              deletedFiles: 0,
              unchangedFiles: 1,
            },
            recallReady: true,
            warnings: [],
          },
          synthesisReadiness: {
            status: "ready",
            modelAlias: "agentic-memory-qwen3-4b",
            warnings: [],
          },
          recallReady: true,
          warnings: [],
        }),
      );

      assert.strictEqual(status.version, 2);
      assert.strictEqual(status.semanticReadiness.index.status, "current");
      assert.isTrue(status.recallReady);
    }),
  );
});
