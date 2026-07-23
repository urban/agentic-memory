import * as BunServices from "@effect/platform-bun/BunServices";
import { decodeAbsolutePath } from "@urban/agentic-memory-core/link/LinkConfig";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";
import { afterAll } from "vitest";
import { resolveStewardTarget } from "../src/commands/steward-target-input.ts";

const StewardTargetInputRuntime = ManagedRuntime.make(BunServices.layer);

const withStewardTargetInputRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R | BunServices.BunServices>,
) =>
  StewardTargetInputRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

const noDirectTarget = {
  vault: Option.none<string>(),
  project: Option.none<string>(),
};

const makeDirectory = Effect.fnUntraced(function* (path: string, explicit = false) {
  return {
    path: yield* decodeAbsolutePath(path),
    explicit,
  };
});

describe("steward target CLI input", () => {
  afterAll(() => StewardTargetInputRuntime.dispose());

  it.effect("resolves a complete direct target relative to the effective directory", () =>
    withStewardTargetInputRuntime(
      Effect.gen(function* () {
        const directory = yield* makeDirectory("/work/project", true);
        const target = yield* resolveStewardTarget({
          vault: Option.some("../vault"),
          project: Option.some("example-project"),
          directory,
        });

        assert.deepStrictEqual(target, {
          vaultPath: "/work/vault",
          projectSlug: "example-project",
        });
      }),
    ),
  );

  it.effect("requires both direct target inputs", () =>
    withStewardTargetInputRuntime(
      Effect.gen(function* () {
        const failure = yield* resolveStewardTarget({
          vault: Option.some("/vault"),
          project: Option.none(),
          directory: yield* makeDirectory("/work"),
        }).pipe(Effect.flip);

        assert.strictEqual(failure.code, "InvalidTarget");
        assert.strictEqual(failure.message, "Direct mode requires both --vault and --project");
      }),
    ),
  );

  it.effect("rejects an invalid direct project slug", () =>
    withStewardTargetInputRuntime(
      Effect.gen(function* () {
        const failure = yield* resolveStewardTarget({
          vault: Option.some("/vault"),
          project: Option.some("[[projects/example-project]]"),
          directory: yield* makeDirectory("/work"),
        }).pipe(Effect.flip);

        assert.strictEqual(failure.code, "InvalidProjectSlug");
        assert.include(failure.message, "Invalid project slug:");
      }),
    ),
  );

  it.effect("resolves a linked target from the effective directory", () =>
    withStewardTargetInputRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-steward-target-",
          });
          const linkDirectory = path.join(projectRoot, ".agentic-memory-link");
          yield* fs.makeDirectory(linkDirectory);
          yield* fs.writeFileString(
            path.join(linkDirectory, "config.json"),
            '{"version":1,"vaultPath":"/vault","projectSlug":"example-project"}\n',
          );

          const target = yield* resolveStewardTarget({
            ...noDirectTarget,
            directory: yield* makeDirectory(projectRoot, true),
          });

          assert.deepStrictEqual(target, {
            vaultPath: "/vault",
            projectSlug: "example-project",
          });
        }),
      ),
    ),
  );

  it.effect("reports a missing linked target", () =>
    withStewardTargetInputRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-steward-target-missing-",
          });
          const failure = yield* resolveStewardTarget({
            ...noDirectTarget,
            directory: yield* makeDirectory(projectRoot),
          }).pipe(Effect.flip);

          assert.strictEqual(failure.code, "MissingLinkConfig");
          assert.include(failure.message, ".agentic-memory-link/config.json");
        }),
      ),
    ),
  );

  it.effect("reports a malformed linked target", () =>
    withStewardTargetInputRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-steward-target-invalid-",
          });
          const linkDirectory = path.join(projectRoot, ".agentic-memory-link");
          yield* fs.makeDirectory(linkDirectory);
          yield* fs.writeFileString(path.join(linkDirectory, "config.json"), "not-json");

          const failure = yield* resolveStewardTarget({
            ...noDirectTarget,
            directory: yield* makeDirectory(projectRoot),
          }).pipe(Effect.flip);

          assert.strictEqual(failure.code, "InvalidLinkConfig");
          assert.include(failure.message, "Invalid .agentic-memory-link/config.json:");
        }),
      ),
    ),
  );
});
