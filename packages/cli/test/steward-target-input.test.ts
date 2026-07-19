import * as BunServices from "@effect/platform-bun/BunServices";
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

describe("steward target CLI input", () => {
  afterAll(() => StewardTargetInputRuntime.dispose());

  it.effect("resolves a complete direct target", () =>
    withStewardTargetInputRuntime(
      resolveStewardTarget({
        vault: Option.some("/vault"),
        project: Option.some("example-project"),
        projectRoot: ".",
      }).pipe(
        Effect.map((target) => {
          assert.deepStrictEqual(target, {
            vaultPath: "/vault",
            projectSlug: "example-project",
            projectRoot: undefined,
          });
        }),
      ),
    ),
  );

  it.effect("requires both direct target inputs", () =>
    withStewardTargetInputRuntime(
      resolveStewardTarget({
        vault: Option.some("/vault"),
        project: Option.none(),
        projectRoot: ".",
      }).pipe(
        Effect.flip,
        Effect.map((failure) => {
          assert.strictEqual(failure.code, "InvalidTarget");
          assert.strictEqual(failure.message, "Direct mode requires both --vault and --project");
        }),
      ),
    ),
  );

  it.effect("rejects an invalid direct project slug", () =>
    withStewardTargetInputRuntime(
      resolveStewardTarget({
        vault: Option.some("/vault"),
        project: Option.some("[[projects/example-project]]"),
        projectRoot: ".",
      }).pipe(
        Effect.flip,
        Effect.map((failure) => {
          assert.strictEqual(failure.code, "InvalidProjectSlug");
          assert.include(failure.message, "Invalid project slug:");
        }),
      ),
    ),
  );

  it.effect("resolves a linked target from the project root", () =>
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
            projectRoot,
          });

          assert.deepStrictEqual(target, {
            vaultPath: "/vault",
            projectSlug: "example-project",
            projectRoot,
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
            projectRoot,
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
            projectRoot,
          }).pipe(Effect.flip);

          assert.strictEqual(failure.code, "InvalidLinkConfig");
          assert.include(failure.message, "Invalid .agentic-memory-link/config.json:");
        }),
      ),
    ),
  );
});
