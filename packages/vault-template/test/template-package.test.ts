import { assert, describe, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { bundledVaultTemplatePath } from "../src/VaultTemplatePackage.ts";

const requiredTemplateFiles: ReadonlyArray<string> = [
  "AGENTS.md",
  "MEMORY.md",
  "USER.md",
  ".agentic-memory/LLM-vault-local.md",
  ".agentic-memory/LLM-outside-vault.md",
  ".agentic-memory/adapters/MEMORY_ADAPTER.md",
  ".agentic-memory/instructions/writing-memory.md",
  ".agentic-memory/instructions/linking-and-maps.md",
  ".agentic-memory/instructions/cross-project-persistence.md",
  ".agentic-memory/instructions/session-capture.md",
  ".agentic-memory/instructions/reflection.md",
  ".agentic-memory/templates/map.md",
  ".agentic-memory/templates/project.md",
  ".agentic-memory/templates/note.md",
  ".agentic-memory/templates/person.md",
  ".agentic-memory/templates/record.md",
  ".agentic-memory/templates/reflection-record.md",
  ".agentic-memory/templates/source.md",
  ".agentic-memory/templates/user.md",
  "maps",
  "projects",
  "notes",
  "people",
  "sources",
  "records",
];

const TemplatePackageRuntime = ManagedRuntime.make(
  Layer.mergeAll(BunFileSystem.layer, BunPath.layer),
);

describe("vault template package", () => {
  afterAll(() => TemplatePackageRuntime.dispose());

  it.effect("resolves the bundled Agentic Memory vault template", () =>
    TemplatePackageRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const templatePath = yield* bundledVaultTemplatePath();
            const existenceChecks = yield* Effect.all(
              requiredTemplateFiles.map((relativePath) =>
                fs.exists(path.join(templatePath, relativePath)),
              ),
            );

            assert.strictEqual(existenceChecks.filter((fileExists) => !fileExists).length, 0);
          }),
          context,
        ),
      ),
    ),
  );
});
