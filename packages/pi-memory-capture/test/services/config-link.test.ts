// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readFileSync, symlinkSync } from "node:fs";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { ConfigProvider, Effect, FileSystem, Layer, ManagedRuntime, PlatformError } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CaptureConfig } from "../../src/services/CaptureConfig.ts";
import { VaultProjects } from "../../src/services/VaultProjects.ts";
import { createTempDirectory, removeTempDirectory, writeFile } from "../helpers.ts";

const InfrastructureLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const CaptureConfigTestLayer = CaptureConfig.layer.pipe(Layer.provide(InfrastructureLayer));
const VaultProjectsTestLayer = VaultProjects.layer.pipe(Layer.provide(InfrastructureLayer));
const CaptureConfigRuntime = ManagedRuntime.make(CaptureConfigTestLayer);
const VaultProjectsRuntime = ManagedRuntime.make(VaultProjectsTestLayer);

describe("CaptureConfig", () => {
  it("reports missing config with the resolved local paths", () => {
    const root = createTempDirectory("pi-memory-config-missing-");
    const cwd = join(root, "project");

    writeFile(join(cwd, "README.md"), "# project\n");

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("missing");
        if (loaded._tag === "missing") {
          expect(loaded.paths.directory).toBe(join(cwd, ".agentic-memory-link"));
          expect(loaded.paths.configFile).toBe(join(cwd, ".agentic-memory-link", "config.json"));
        }
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("loads valid .agentic-memory-link config without overriding its stored vault path", () => {
    const root = createTempDirectory("pi-memory-config-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".agentic-memory-link");
    const vaultA = join(root, "vault-a");
    const vaultB = join(root, "vault-b");

    for (const vault of [vaultA, vaultB]) {
      writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
      writeFile(
        join(vault, ".agentic-memory", "instructions", "session-capture.md"),
        "# capture\n",
      );
      writeFile(join(vault, "MEMORY.md"), "# Memory\n");
      writeFile(join(vault, "USER.md"), "# User\n");
      writeFile(join(vault, "projects", ".gitkeep"), "");
    }
    writeFile(
      join(localDirectory, "config.json"),
      `{"version":1,"vaultPath":"${vaultA}","projectSlug":"capture-extension"}\n`,
    );

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("valid");
        if (loaded._tag === "valid") {
          expect(loaded.paths.directory.endsWith(".agentic-memory-link")).toBe(true);
          expect(loaded.config.vaultPath).toBe(vaultA);
          expect(loaded.config.projectSlug).toBe("capture-extension");
        }
      }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: {
              AGENTIC_MEMORY_VAULT: vaultB,
            },
          }),
        ),
      ),
    ).finally(() => removeTempDirectory(root));
  });

  it("rejects invalid project links and missing steward contracts", () => {
    const root = createTempDirectory("pi-memory-config-invalid-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".agentic-memory-link");

    writeFile(
      join(localDirectory, "config.json"),
      '{"version":1,"vaultPath":"/not-a-vault","projectSlug":"[[notes/not-project]]"}\n',
    );

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("invalid");
        if (loaded._tag === "invalid") {
          expect(loaded.message).toContain("Invalid config JSON");
        }
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("reports valid link configs as invalid when the target vault is unhealthy", () => {
    const root = createTempDirectory("pi-memory-config-unhealthy-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(join(vault, "MEMORY.md"), "# Memory\n");
    writeFile(join(vault, "USER.md"), "# User\n");
    writeFile(join(vault, "projects", ".gitkeep"), "");
    writeFile(
      join(cwd, ".agentic-memory-link", "config.json"),
      `{"version":1,"vaultPath":"${vault}","projectSlug":"capture-extension"}\n`,
    );

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("invalid");
        if (loaded._tag === "invalid") {
          expect(loaded.message).toBe(
            `Vault is missing .agentic-memory/instructions/session-capture.md: ${join(
              vault,
              ".agentic-memory",
              "instructions",
              "session-capture.md",
            )}`,
          );
        }
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("writes only config.json under the link directory", () => {
    const root = createTempDirectory("pi-memory-config-write-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const paths = yield* config.ensureLocalFiles(cwd, {
          version: 1,
          vaultPath: vault,
          projectSlug: "capture-extension",
        });

        expect(paths.directory.endsWith(".agentic-memory-link")).toBe(true);
        expect(readFileSync(paths.configFile, "utf8")).toContain("capture-extension");
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("rejects symlinked config files instead of reading through them", () => {
    const root = createTempDirectory("pi-memory-config-symlink-load-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".agentic-memory-link");
    const targetFile = join(root, "outside-config.json");

    writeFile(join(cwd, "README.md"), "# project\n");
    writeFile(
      targetFile,
      '{"version":1,"vaultPath":"/vault-a","projectSlug":"capture-extension"}\n',
    );
    writeFile(join(localDirectory, ".gitkeep"), "");
    symlinkSync(targetFile, join(localDirectory, "config.json"));

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const loaded = yield* config.load(cwd);

        expect(loaded._tag).toBe("invalid");
        if (loaded._tag === "invalid") {
          expect(loaded.message).toContain("must not be a symlink");
        }
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("rejects symlinked config targets instead of overwriting them", () => {
    const root = createTempDirectory("pi-memory-config-symlink-write-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".agentic-memory-link");
    const targetFile = join(root, "outside-config.json");

    writeFile(join(cwd, "README.md"), "# project\n");
    writeFile(targetFile, '{"version":1,"vaultPath":"/vault-a","projectSlug":"old-project"}\n');
    writeFile(join(localDirectory, ".gitkeep"), "");
    symlinkSync(targetFile, join(localDirectory, "config.json"));

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const written = yield* config
          .ensureLocalFiles(cwd, {
            version: 1,
            vaultPath: join(root, "vault-b"),
            projectSlug: "capture-extension",
          })
          .pipe(Effect.exit);

        expect(written._tag).toBe("Failure");
        expect(readFileSync(targetFile, "utf8")).toBe(
          '{"version":1,"vaultPath":"/vault-a","projectSlug":"old-project"}\n',
        );
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("rejects symlinked link directories before creating config files", () => {
    const root = createTempDirectory("pi-memory-config-symlink-dir-");
    const cwd = join(root, "project");
    const outsideDirectory = join(root, "outside-link");

    writeFile(join(cwd, "README.md"), "# project\n");
    writeFile(join(outsideDirectory, ".gitkeep"), "");
    symlinkSync(outsideDirectory, join(cwd, ".agentic-memory-link"));

    return CaptureConfigRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* CaptureConfig;
        const written = yield* config
          .ensureLocalFiles(cwd, {
            version: 1,
            vaultPath: join(root, "vault"),
            projectSlug: "capture-extension",
          })
          .pipe(Effect.exit);

        expect(written._tag).toBe("Failure");
        expect(readFileSync(join(outsideDirectory, ".gitkeep"), "utf8")).toBe("");
      }),
    ).finally(() => removeTempDirectory(root));
  });
});

describe("VaultProjects", () => {
  it("creates project files and updates MEMORY routes", () => {
    const root = createTempDirectory("pi-memory-init-");
    const vault = join(root, "vault");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(vault, "MEMORY.md"),
      `---
updated: 2026-01-01
---

# Memory

## Current

- Active work.
`,
    );

    return VaultProjectsRuntime.runPromise(
      Effect.gen(function* () {
        const projects = yield* VaultProjects;
        const projectConfig: import("@urban/agentic-memory-core/link/LinkConfig").LinkConfig = {
          version: 1,
          vaultPath: vault,
          projectSlug: "capture-extension",
        };
        const created = yield* projects.ensureProjectFile(projectConfig, "2026-06-05");
        const routeAdded = yield* projects.ensureMemoryRoute(projectConfig, "2026-06-05");

        expect(created).toBe(true);
        expect(routeAdded).toBe(true);
      }),
    ).finally(() => removeTempDirectory(root));
  });

  it("does not fall back to the builtin scaffold when the project template check fails", () => {
    const written: string[] = [];
    const runtime = ManagedRuntime.make(
      VaultProjects.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            FileSystem.layerNoop({
              exists: (path) =>
                path.endsWith("/projects/capture-extension.md")
                  ? Effect.succeed(false)
                  : path.endsWith("/.agentic-memory/templates/project.md")
                    ? Effect.fail(
                        PlatformError.systemError({
                          module: "FileSystem",
                          method: "exists",
                          _tag: "PermissionDenied",
                          pathOrDescriptor: path,
                        }),
                      )
                    : Effect.succeed(false),
              makeDirectory: () => Effect.void,
              writeFileString: (_path, content) =>
                Effect.sync(() => {
                  written.push(content);
                }),
            }),
            BunPath.layer,
          ),
        ),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const projects = yield* VaultProjects;
          const projectConfig: import("@urban/agentic-memory-core/link/LinkConfig").LinkConfig = {
            version: 1,
            vaultPath: "/vault",
            projectSlug: "capture-extension",
          };
          const result = yield* projects
            .ensureProjectFile(projectConfig, "2026-06-05")
            .pipe(Effect.exit);

          expect(result._tag).toBe("Failure");
          expect(written).toHaveLength(0);
        }),
      )
      .finally(() => runtime.dispose());
  });
});
