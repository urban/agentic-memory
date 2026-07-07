import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { recall } from "../src/recall/Recall.ts";

const fixtureVaultPath = fileURLToPath(
  new URL("./fixtures/retrieval/basic-vault/", import.meta.url),
);
const alphaQuestion =
  "In Alpha Product, I need to tune the retry scheduler. What latency budget decision should I follow, and how should I present options back to Urban?";

const CoreRecallRuntime = ManagedRuntime.make(BunServices.layer);

const withCoreRecallRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | BunServices.BunServices>) =>
  CoreRecallRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

describe("core recall", () => {
  afterAll(() => CoreRecallRuntime.dispose());

  it.effect("answers the Alpha fixture question with cleaned lexical recall facts", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: alphaQuestion,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.question, alphaQuestion);
        assert.deepStrictEqual(response.warnings, []);
        assert.include(response.answer, "200ms p95");
        assert.include(response.answer, "stack-ranked");
        assert.include(response.answer, "capital-letter");
        assert.notInclude(response.answer, "5 second batch retry window");
        assert.notInclude(response.answer, "**");
        assert.notInclude(response.answer, "[[");
        assert.notInclude(response.answer, "`");
      }),
    ),
  );

  it.effect("rejects whitespace-only questions before reading the vault", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: "/vault/that/should/not/be/read",
        question: " \n\t ",
      }).pipe(Effect.exit),
    ).pipe(
      Effect.map((exit) => {
        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const reason = exit.cause.reasons[0];
          assert.isTrue(reason !== undefined && Cause.isFailReason(reason));
          if (reason !== undefined && Cause.isFailReason(reason)) {
            const error = reason.error;
            assert.strictEqual(error._tag, "RecallError");
            assert.strictEqual(error.reason, "InvalidQuestion");
          }
        }
      }),
    ),
  );

  it.effect("ignores control-plane files and prefers curated memory over raw sources", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-",
          });

          yield* Effect.forEach(
            [".agentic-memory", "notes", "sources"] satisfies ReadonlyArray<string>,
            (relativePath) =>
              fs.makeDirectory(path.join(vaultPath, relativePath), { recursive: true }),
          );
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "USER.md"),
            `# User

- When presenting prioritization options, use stack-ranked capital-letter choices.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "alpha-latency-budget.md"),
            `# Alpha Latency Budget

Alpha Product interactive retry scheduling should use a **200ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "sources", "alpha-scheduler-source.md"),
            `# Alpha Scheduler Source

Alpha Product interactive retry scheduling should use a **100ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "control-plane.md"),
            `# Control Plane

Alpha Product interactive retry scheduling should use a **1ms p95 latency budget**.
`,
          );

          return yield* recall({
            vaultPath,
            question: alphaQuestion,
          });
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.include(response.answer, "200ms p95");
        assert.include(response.answer, "stack-ranked");
        assert.include(response.answer, "capital-letter");
        assert.notInclude(response.answer, "100ms p95");
        assert.notInclude(response.answer, "1ms p95");
      }),
    ),
  );
});
