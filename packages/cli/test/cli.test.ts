import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, FileSystem, ManagedRuntime, Path, Runtime } from "effect";
import { afterAll } from "vitest";
import { appLayer, runAgenticMemoryCommand } from "../src/cli.ts";

const formatConsoleArgs = (args: ReadonlyArray<unknown>): string => args.map(String).join(" ");

const makeCaptureConsole = (capture: { stdout: string; stderr: string }): Console.Console => ({
  assert(condition: boolean, ...args: ReadonlyArray<unknown>): void {
    if (!condition) {
      capture.stderr += `${formatConsoleArgs(args)}\n`;
    }
  },
  clear(): void {},
  count(_label?: string): void {},
  countReset(_label?: string): void {},
  debug(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  dir(item: unknown): void {
    capture.stdout += `${String(item)}\n`;
  },
  dirxml(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  error(...args: ReadonlyArray<unknown>): void {
    capture.stderr += `${formatConsoleArgs(args)}\n`;
  },
  group(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  groupCollapsed(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  groupEnd(): void {},
  info(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  log(...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  table(tabularData: unknown): void {
    capture.stdout += `${String(tabularData)}\n`;
  },
  time(_label?: string): void {},
  timeEnd(_label?: string): void {},
  timeLog(_label?: string, ...args: ReadonlyArray<unknown>): void {
    capture.stdout += `${formatConsoleArgs(args)}\n`;
  },
  trace(...args: ReadonlyArray<unknown>): void {
    capture.stderr += `${formatConsoleArgs(args)}\n`;
  },
  warn(...args: ReadonlyArray<unknown>): void {
    capture.stderr += `${formatConsoleArgs(args)}\n`;
  },
});

const exitCodeFromExit = (exit: Exit.Exit<void, unknown>): number =>
  Exit.isSuccess(exit) ? 0 : Runtime.getErrorExitCode(Cause.squash(exit.cause));

const AgenticMemoryCliRuntime = ManagedRuntime.make(appLayer);

const withCliRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R | import("../src/cli.ts").CliRequirements>,
) =>
  AgenticMemoryCliRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

const runCapturedEffect = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const capture = { stdout: "", stderr: "" };
    const exit = yield* runAgenticMemoryCommand(args).pipe(
      Effect.provideService(Console.Console, makeCaptureConsole(capture)),
      Effect.exit,
    );
    return {
      exitCode: exitCodeFromExit(exit),
      stdout: capture.stdout,
      stderr: capture.stderr,
    };
  });

describe("agentic-memory cli", () => {
  afterAll(() => AgenticMemoryCliRuntime.dispose());

  it.effect("can import the public recall contract from core exports", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeRecallSuccessJson(
        '{"status":"answered","question":"What should I follow?","answer":"Follow the contract.","warnings":[]}',
      );

      assert.strictEqual(decoded.status, "answered");
      assert.strictEqual(decoded.answer, "Follow the contract.");
    }),
  );

  it.effect("emits JSON command errors to stdout", () =>
    withCliRuntime(
      runCapturedEffect(["link", "--vault", "relative", "--project", "example-project", "--json"]),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"status":"failed"');
        assert.include(output.stdout, '"code":"InvalidVault"');
        assert.include(output.stderr, "InvalidVault");
      }),
    ),
  );

  it.effect("rejects linking vaults that are missing session-capture guidance", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-link-missing-capture-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          const configPath = path.join(projectRoot, ".agentic-memory-link", "config.json");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(projectRoot, { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );

          const output = yield* runCapturedEffect([
            "link",
            "--vault",
            vaultPath,
            "--project",
            "example-project",
            "--project-root",
            projectRoot,
            "--json",
          ]);
          const configExists = yield* fs.exists(configPath);

          return { configExists, output };
        }),
      ),
    ).pipe(
      Effect.map(({ configExists, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"InvalidVault"');
        assert.include(output.stdout, "session-capture.md");
        assert.isFalse(configExists);
      }),
    ),
  );

  it.effect("reports unlinked status without searching ancestors", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "agentic-memory-cli-" });
          return yield* runCapturedEffect(["status", "--project-root", projectRoot, "--json"]);
        }),
      ),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 0);
        assert.include(output.stdout, '"status":"unlinked"');
        assert.include(output.stdout, ".agentic-memory-link/config.json");
        assert.strictEqual(output.stderr, "");
      }),
    ),
  );

  it.effect("surfaces missing session-capture guidance in unhealthy status details", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-status-missing-capture-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(projectRoot, ".agentic-memory-link"), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(projectRoot, ".agentic-memory-link", "config.json"),
            `{"version":1,"vaultPath":"${vaultPath}","projectSlug":"example-project"}\n`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            `# Memory

## Projects

- [[projects/example-project]] — example-project.
`,
          );
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "example-project.md"),
            "# example-project\n",
          );

          return yield* runCapturedEffect(["status", "--project-root", projectRoot, "--json"]);
        }),
      ),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 0);
        assert.include(output.stdout, '"status":"unhealthy"');
        assert.include(output.stdout, '"sessionCaptureInstructionsExists":false');
      }),
    ),
  );

  it.effect("initializes vaults from the canonical template package", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({ prefix: "agentic-memory-init-" });
          const vaultPath = path.join(tempRoot, "vault");
          const output = yield* runCapturedEffect(["init", vaultPath, "--json"]);
          const memoryExists = yield* fs.exists(path.join(vaultPath, "MEMORY.md"));
          const localContractExists = yield* fs.exists(
            path.join(vaultPath, ".agentic-memory", "LLM-vault-local.md"),
          );
          const adapterExists = yield* fs.exists(
            path.join(vaultPath, ".agentic-memory", "adapters", "MEMORY_ADAPTER.md"),
          );
          const sessionCaptureExists = yield* fs.exists(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
          );

          return {
            adapterExists,
            localContractExists,
            memoryExists,
            output,
            sessionCaptureExists,
          };
        }),
      ),
    ).pipe(
      Effect.map(
        ({ adapterExists, localContractExists, memoryExists, output, sessionCaptureExists }) => {
          assert.strictEqual(output.exitCode, 0);
          assert.include(output.stdout, '"status":"initialized"');
          assert.strictEqual(output.stderr, "");
          assert.isTrue(memoryExists);
          assert.isTrue(localContractExists);
          assert.isTrue(adapterExists);
          assert.isTrue(sessionCaptureExists);
        },
      ),
    ),
  );

  it.effect("does not mutate the vault when local link config creation fails", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-link-atomicity-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          const memoryPath = path.join(vaultPath, "MEMORY.md");
          const projectFilePath = path.join(vaultPath, "projects", "example-project.md");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(projectRoot, { recursive: true });
          yield* fs.writeFileString(memoryPath, "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
            "session-capture contract",
          );
          yield* fs.chmod(projectRoot, 0o555);

          const output = yield* runCapturedEffect([
            "link",
            "--vault",
            vaultPath,
            "--project",
            "example-project",
            "--project-root",
            projectRoot,
            "--json",
          ]).pipe(Effect.ensuring(fs.chmod(projectRoot, 0o755).pipe(Effect.orDie)));

          const memoryContents = yield* fs.readFileString(memoryPath);
          const projectFileExists = yield* fs.exists(projectFilePath);

          return { memoryContents, output, projectFileExists };
        }),
      ),
    ).pipe(
      Effect.map(({ memoryContents, output, projectFileExists }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"WriteConfigFailed"');
        assert.isFalse(projectFileExists);
        assert.notInclude(memoryContents, "[[projects/example-project]]");
      }),
    ),
  );

  it.effect("does not leave a local link behind when vault setup fails", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-link-rollback-",
          });
          const vaultPath = path.join(tempRoot, "vault");
          const projectRoot = path.join(tempRoot, "project");
          const configPath = path.join(projectRoot, ".agentic-memory-link", "config.json");

          yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "instructions"), {
            recursive: true,
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
            recursive: true,
          });
          yield* fs.makeDirectory(projectRoot, { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
            "outside-vault contract",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "instructions", "session-capture.md"),
            "session-capture contract",
          );
          yield* fs.chmod(path.join(vaultPath, "projects"), 0o555);

          const output = yield* runCapturedEffect([
            "link",
            "--vault",
            vaultPath,
            "--project",
            "example-project",
            "--project-root",
            projectRoot,
            "--yes",
            "--json",
          ]).pipe(
            Effect.ensuring(
              fs
                .chmod(path.join(vaultPath, "projects"), 0o755)
                .pipe(Effect.catch(() => Effect.void)),
            ),
          );
          const configExists = yield* fs.exists(configPath);

          return { configExists, output };
        }),
      ),
    ).pipe(
      Effect.map(({ configExists, output }) => {
        assert.strictEqual(output.exitCode, 1);
        assert.include(output.stdout, '"code":"ProjectFileFailed"');
        assert.isFalse(configExists);
      }),
    ),
  );
});
