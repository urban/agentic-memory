import { decodeRecallSuccessJson } from "@urban/agentic-memory-core/recall/Recall";
import { decodeInitCommandResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import { makeFakeEmbeddingModelLayer } from "@urban/agentic-memory-core/semantic/EmbeddingModel";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, FileSystem, ManagedRuntime, Path, Runtime } from "effect";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { makeAppLayer, runAgenticMemoryCommand } from "../src/cli.ts";

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

const recallFixtureVaultPath = fileURLToPath(
  new URL("../../core/test/fixtures/retrieval/basic-vault/", import.meta.url),
);
const recallQuestion =
  "In Alpha Product, what latency budget should I follow, and how should I present options back to Urban?";
const unknownRecallQuestion = "What launch window did Gamma Project choose?";
const sourceVerificationQuestion =
  "What source verification evidence did the Alpha Product responsiveness trial record for the latency decision?";

const AgenticMemoryCliRuntime = ManagedRuntime.make(makeAppLayer(makeFakeEmbeddingModelLayer()));

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
      Effect.flatMap(
        ({ adapterExists, localContractExists, memoryExists, output, sessionCaptureExists }) =>
          Effect.gen(function* () {
            assert.strictEqual(output.exitCode, 0);
            const result = yield* decodeInitCommandResultJson(output.stdout);
            assert.strictEqual(result.status, "initialized");
            assert.strictEqual(result.model.status, "available");
            assert.strictEqual(result.model.installation, "already_available");
            assert.isFalse(result.changes.updatedGitIgnore);
            assert.strictEqual(output.stderr, "");
            assert.isTrue(memoryExists);
            assert.isTrue(localContractExists);
            assert.isTrue(adapterExists);
            assert.isTrue(sessionCaptureExists);
          }),
      ),
    ),
  );

  it.effect("reports model and semantic-index ignore state in human init output", () =>
    withCliRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-init-human-",
          });
          return yield* runCapturedEffect(["init", path.join(tempRoot, "vault")]);
        }),
      ),
    ).pipe(
      Effect.map((output) => {
        assert.strictEqual(output.exitCode, 0);
        assert.include(
          output.stdout,
          "Embedding model embeddinggemma-300M-Q8_0 was already available",
        );
        assert.include(output.stdout, ".agentic-memory/index/");
        assert.strictEqual(output.stderr, "");
      }),
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
            Effect.ensuring(fs.chmod(path.join(vaultPath, "projects"), 0o755).pipe(Effect.ignore)),
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
