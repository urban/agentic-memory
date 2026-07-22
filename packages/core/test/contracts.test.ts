import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, ManagedRuntime, Path, Sink, Stream } from "effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { afterAll } from "vitest";
import { decodeCapturePayloadJson, MESSAGE_CHAR_LIMIT } from "../src/capture/CapturePayload.ts";
import { shapeCapturePayload } from "../src/capture/PayloadShaping.ts";
import {
  decodeLinkConfig,
  decodeLinkConfigJson,
  loadLinkConfig,
  writeLinkConfig,
} from "../src/link/LinkConfig.ts";
import {
  decodeProjectSlug,
  projectFileRelativePathFromSlug,
  projectWikiLinkFromSlug,
} from "../src/link/ProjectSlug.ts";
import {
  buildPiProcessCommand,
  extractAssistantText,
  extractStewardSessionPointer,
  PiProcessRunnerLayer,
} from "../src/steward/PiProcessRunner.ts";
import {
  decodeRecallRequest,
  decodeRecallResponse,
  decodeRecallSuccessJson,
} from "../src/recall/Recall.ts";
import { StewardRunner } from "../src/steward/StewardExecution.ts";
import { decodeStewardResultJson } from "../src/steward/StewardResult.ts";
import { makeFakeEmbeddingModelLayer } from "../src/semantic/EmbeddingModel.ts";
import { ensureProjectFile, ensureProjectRouteInMemory } from "../src/vault/ProjectRoute.ts";
import { checkVaultHealth, validateVaultForLink } from "../src/vault/VaultStatus.ts";
import { initVaultFromTemplate } from "../src/vault/VaultTemplate.ts";

const validPayloadJson =
  '{"version":1,"projectSlug":"agentic-memory-cli","messages":[{"role":"user","text":"hello"}]}';

const sessionHeaderLine =
  '{"type":"session","version":3,"id":"session-1","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/vault"}\n';

const CoreContractsRuntime = ManagedRuntime.make(
  Layer.merge(BunServices.layer, makeFakeEmbeddingModelLayer()),
);

const timeoutingSpawnerLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make((_command) =>
    Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(12345),
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode(sessionHeaderLine)).pipe(
          Stream.concat(Stream.never),
        ),
        stderr: Stream.empty,
        all: Stream.make(new TextEncoder().encode(sessionHeaderLine)).pipe(
          Stream.concat(Stream.never),
        ),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    ),
  ),
);

describe("core contracts", () => {
  afterAll(() => CoreContractsRuntime.dispose());

  it.effect("validates project slugs and derives vault routes", () =>
    Effect.gen(function* () {
      const slug = yield* decodeProjectSlug("agentic-memory-cli");
      const invalid = yield* decodeProjectSlug("[[projects/foo]]").pipe(Effect.exit);

      assert.strictEqual(projectWikiLinkFromSlug(slug), "[[projects/agentic-memory-cli]]");
      assert.strictEqual(projectFileRelativePathFromSlug(slug), "projects/agentic-memory-cli.md");
      assert.strictEqual(invalid._tag, "Failure");
    }),
  );

  it.effect(
    "decodes shared link config with projectSlug and rejects projectLink-only configs",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeLinkConfigJson(
          '{"version":1,"vaultPath":"/vault","projectSlug":"agentic-memory-cli"}',
        );
        const oldShape = yield* decodeLinkConfigJson(
          '{"version":1,"vaultPath":"/vault","projectLink":"[[projects/agentic-memory-cli]]"}',
        ).pipe(Effect.exit);

        assert.strictEqual(decoded.projectSlug, "agentic-memory-cli");
        assert.strictEqual(oldShape._tag, "Failure");
      }),
  );

  it.effect("rejects symlinked link config paths instead of following them", () =>
    CoreContractsRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const root = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-core-link-symlink-",
              });
              const projectRoot = path.join(root, "project");
              const linkDirectory = path.join(projectRoot, ".agentic-memory-link");
              const configFile = path.join(linkDirectory, "config.json");
              const targetFile = path.join(root, "outside-config.json");

              yield* fs.makeDirectory(linkDirectory, { recursive: true });
              yield* fs.writeFileString(
                targetFile,
                '{"version":1,"vaultPath":"/vault-a","projectSlug":"old-project"}\n',
              );
              yield* fs.symlink(targetFile, configFile);

              const loaded = yield* loadLinkConfig(projectRoot);
              const writeResult = yield* decodeLinkConfig({
                version: 1,
                vaultPath: "/vault-b",
                projectSlug: yield* decodeProjectSlug("agentic-memory-cli"),
              }).pipe(
                Effect.flatMap((config) => writeLinkConfig(projectRoot, config)),
                Effect.exit,
              );
              const targetContents = yield* fs.readFileString(targetFile);

              assert.strictEqual(loaded._tag, "invalid");
              if (loaded._tag === "invalid") {
                assert.include(loaded.message, "must not be a symlink");
              }
              assert.strictEqual(writeResult._tag, "Failure");
              assert.strictEqual(
                targetContents,
                '{"version":1,"vaultPath":"/vault-a","projectSlug":"old-project"}\n',
              );
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("validates capture payloads and shapes visible text", () =>
    Effect.gen(function* () {
      const githubToken = "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ11";
      const decoded = yield* decodeCapturePayloadJson(validPayloadJson);
      const empty = yield* decodeCapturePayloadJson(
        '{"version":1,"projectSlug":"agentic-memory-cli","messages":[]}',
      ).pipe(Effect.exit);
      const shaped = yield* shapeCapturePayload({
        projectSlug: "agentic-memory-cli",
        messages: [
          {
            role: "user",
            text: "\r\n   ",
          },
          {
            role: "assistant",
            text: `Bearer sk-ant-1234567890abcdefghijklmnopqrstuvwxyz\r\n\r\n\r\n\r\nOPENAI_API_KEY=abc123\r\n${githubToken}\r\n${"x".repeat(7_000)}`,
          },
        ],
      });

      assert.strictEqual(decoded.messages.length, 1);
      assert.strictEqual(empty._tag, "Failure");
      switch (shaped._tag) {
        case "Payload": {
          const text = shaped.payload?.messages[0]?.text ?? "";
          assert.isAtMost(text.length, MESSAGE_CHAR_LIMIT);
          assert.include(text, "Bearer [REDACTED]");
          assert.include(text, "OPENAI_API_KEY=[REDACTED]");
          assert.include(text, "[REDACTED_GITHUB_TOKEN]");
          assert.notInclude(text, "abc123");
          assert.notInclude(text, githubToken);
          assert.notInclude(text, "\r");
          assert.notInclude(text, "\n\n\n");
          assert.strictEqual(shaped.coveredInputMessageCount, 2);
          assert.isTrue(shaped.warnings.some((warning) => warning.includes("Whitespace-only")));
          assert.isTrue(shaped.warnings.some((warning) => warning.includes("truncated")));
          break;
        }
        case "NoMessages":
          assert.fail("expected shaped payload");
      }
    }),
  );

  it.effect(
    "normalizes steward result arrays and requires captured summaries and decision reports",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeStewardResultJson(
          '{"status":"captured","summary":"Record memory CLI","decisionReport":{"decisionSummary":"Project memory should be updated.","durability":"durable","selectedDestinations":[{"target":"projects/agentic-memory-cli.md","memoryLayer":"project","reason":"The observation is project-specific durable context."}],"skippedDestinations":[],"durableSignals":["Future sessions need the project update."],"duplicateSignals":[],"privacyNotes":["No raw transcript text was stored."]}}',
        );
        const missingSummary = yield* decodeStewardResultJson('{"status":"captured"}').pipe(
          Effect.exit,
        );
        const missingDecisionReport = yield* decodeStewardResultJson(
          '{"status":"captured","summary":"Record memory CLI"}',
        ).pipe(Effect.exit);

        assert.deepStrictEqual(decoded.filesChanged, []);
        assert.deepStrictEqual(decoded.warnings, []);
        assert.strictEqual(missingSummary._tag, "Failure");
        assert.strictEqual(missingDecisionReport._tag, "Failure");
      }),
  );

  it.effect("defines the core recall request and response contract", () =>
    Effect.gen(function* () {
      const request = yield* decodeRecallRequest({
        vaultPath: "/vault",
        question: "What should I remember?",
        includeSources: false,
      });
      const response = yield* decodeRecallResponse({
        status: "answered",
        question: request.question,
        answer: "Remember the answer.",
        warnings: [],
      });
      const notFoundResponse = yield* decodeRecallResponse({
        status: "not_found",
        question: request.question,
        answer: "I don't know based on the available Agentic Memory.",
        warnings: [],
      });
      const missingQuestion = yield* decodeRecallRequest({
        vaultPath: "/vault",
        includeSources: false,
      }).pipe(Effect.exit);
      const missingSourcePolicy = yield* decodeRecallRequest({
        vaultPath: "/vault",
        question: "What should I remember?",
      }).pipe(Effect.exit);

      assert.strictEqual(request.vaultPath, "/vault");
      assert.strictEqual(request.question, "What should I remember?");
      assert.isFalse(request.includeSources);
      assert.strictEqual(response.status, "answered");
      assert.strictEqual(notFoundResponse.status, "not_found");
      assert.deepStrictEqual(response.warnings, []);
      assert.strictEqual(missingQuestion._tag, "Failure");
      assert.strictEqual(missingSourcePolicy._tag, "Failure");
    }),
  );

  it.effect("rejects excess fields in public recall success JSON", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeRecallSuccessJson(
        '{"status":"answered","question":"Where is the fact?","answer":"It is here.","warnings":[]}',
      );
      const withTrace = yield* decodeRecallSuccessJson(
        '{"status":"answered","question":"Where is the fact?","answer":"It is here.","warnings":[],"selectedFiles":["notes/example.md"],"provider":"lexical","snippets":[],"scores":[],"trace":{}}',
      ).pipe(Effect.exit);

      assert.deepStrictEqual(decoded, {
        status: "answered",
        question: "Where is the fact?",
        answer: "It is here.",
        warnings: [],
      });
      assert.strictEqual(withTrace._tag, "Failure");
    }),
  );

  it.effect("validates bounded steward decision reports", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeStewardResultJson(
        '{"status":"no_changes","decisionReport":{"decisionSummary":"No durable memory was observed.","durability":"not_durable","selectedDestinations":[],"skippedDestinations":[{"memoryLayer":"USER","reason":"No stable user preference or owner fact was observed."}],"durableSignals":[],"duplicateSignals":[],"privacyNotes":["No raw transcript text was stored."]}}',
      );
      const oversizedSummary = "x".repeat(501);
      const oversized = yield* decodeStewardResultJson(
        `{"status":"no_changes","decisionReport":{"decisionSummary":"${oversizedSummary}","durability":"uncertain","selectedDestinations":[],"skippedDestinations":[],"durableSignals":[],"duplicateSignals":[],"privacyNotes":[]}}`,
      ).pipe(Effect.exit);

      assert.strictEqual(decoded.decisionReport.durability, "not_durable");
      assert.strictEqual(oversized._tag, "Failure");
    }),
  );

  it.effect("constructs isolated Pi runner commands and extracts final assistant JSON", () =>
    Effect.gen(function* () {
      const command = buildPiProcessCommand({
        piBinary: "pi-test",
        request: {
          context: {
            status: "ready",
            payload: yield* decodeCapturePayloadJson(validPayloadJson),
            vault: {
              path: "/vault",
              projectFile: "/vault/projects/agentic-memory-cli.md",
              memoryFile: "/vault/MEMORY.md",
              userFile: "/vault/USER.md",
              outsideVaultInstructions: "/vault/.agentic-memory/LLM-outside-vault.md",
            },
            instructions: {
              outsideVault: "contract",
              prompt: "prompt",
            },
            resultContract: {
              statusValues: ["captured", "no_changes"],
              capturedRequiresSummary: true,
            },
            warnings: [],
          },
          correlation: {
            attemptId: "attempt-1",
          },
          options: {
            provider: "anthropic",
            model: "claude",
            thinking: "medium",
          },
        },
      });
      const assistantText = extractAssistantText(
        '{"type":"message_update"}\n{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"{\\"status\\":\\"no_changes\\"}"}]}}\n',
      );

      assert.strictEqual(command.command, "pi-test");
      assert.include(command.args, "--name");
      assert.include(command.args, "Memory Steward capture attempt-1");
      assert.include(command.args, "--no-context-files");
      assert.notInclude(command.args, "--no-session");
      assert.notInclude(command.args, "--continue");
      assert.notInclude(command.args, "--session");
      assert.notInclude(command.args, "--fork");
      assert.notInclude(command.args, "--clone");
      assert.notInclude(command.args, "--no-tools");
      assert.include(command.args, "--provider");
      assert.include(command.args, "anthropic");
      const stewardSession = extractStewardSessionPointer(
        '{"type":"session","version":3,"id":"session-1","timestamp":"2026-06-15T12:00:00.000Z","cwd":"/vault"}\n',
        "Memory Steward capture attempt-1",
      );

      assert.strictEqual(command.cwd, "/vault");
      assert.strictEqual(assistantText, '{"status":"no_changes"}');
      assert.strictEqual(stewardSession?.sessionId, "session-1");
      assert.strictEqual(stewardSession?.name, "Memory Steward capture attempt-1");
    }),
  );

  it.effect(
    "preserves the steward session pointer when the Pi process times out after emitting the session header",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            PiProcessRunnerLayer.pipe(Layer.provide(timeoutingSpawnerLayer)),
          );
          const runner = Context.get(context, StewardRunner);
          const payload = yield* decodeCapturePayloadJson(validPayloadJson);
          const fiber = yield* runner
            .run({
              context: {
                status: "ready",
                payload,
                vault: {
                  path: "/vault",
                  projectFile: "/vault/projects/agentic-memory-cli.md",
                  memoryFile: "/vault/MEMORY.md",
                  userFile: "/vault/USER.md",
                  outsideVaultInstructions: "/vault/.agentic-memory/LLM-outside-vault.md",
                },
                instructions: {
                  outsideVault: "contract",
                  prompt: "prompt",
                },
                resultContract: {
                  statusValues: ["captured", "no_changes"],
                  capturedRequiresSummary: true,
                },
                warnings: [],
              },
              correlation: {
                attemptId: "attempt-1",
              },
              options: {
                timeoutMillis: 10,
              },
            })
            .pipe(Effect.flip, Effect.forkChild);

          yield* Effect.yieldNow;
          yield* TestClock.adjust(10);

          const error = yield* Fiber.join(fiber);

          assert.strictEqual(
            error.message,
            "Timed out waiting for steward final JSON after child process launch",
          );
          assert.strictEqual(error.stewardSession?.sessionId, "session-1");
          assert.strictEqual(error.stewardSession?.name, "Memory Steward capture attempt-1");
          assert.strictEqual(error.stewardSession?.cwd, "/vault");
        }),
      ),
  );

  it.effect("adds a dedicated project route instead of accepting incidental project mentions", () =>
    Effect.sync(() => {
      const updated = ensureProjectRouteInMemory(
        `---
updated: 2026-06-01
---

# Memory

## Current

- Mention [[projects/agentic-memory-cli]] in prose only.
`,
        "agentic-memory-cli",
        "2026-06-16",
      );

      assert.strictEqual(updated.added, true);
      assert.match(
        updated.content,
        /## Projects\n\n- \[\[projects\/agentic-memory-cli\]\] — agentic-memory-cli\./,
      );
    }),
  );

  it.effect("does not copy placeholder example links into generated project files", () =>
    CoreContractsRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const vaultPath = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-core-project-template-",
              });
              const templatePath = path.join(
                vaultPath,
                ".agentic-memory",
                "templates",
                "project.md",
              );

              yield* fs.makeDirectory(path.dirname(templatePath), { recursive: true });
              yield* fs.writeFileString(
                templatePath,
                `# Project Template

\`\`\`md
---
type: project
project_status: candidate
summary: "One-line project summary."
---

# Project Name

## Resume context

Placeholder.

## Project timeline

- YYYY-MM-DD: Placeholder milestone.

## Decision log

- Decision: Placeholder.
  Rationale: Placeholder.

## Routing

- [[notes/example]] — short description. Read when: condition.

## Semantic links

> [!info] Semantic links
>
> - [[projects/example]] — parent, origin, or broader effort. Read when: condition.
\`\`\`
`,
              );

              const created = yield* ensureProjectFile({
                vaultPath,
                projectSlug: yield* decodeProjectSlug("agentic-memory-cli"),
                date: "2026-06-16",
              });
              const projectPath = path.join(vaultPath, "projects", "agentic-memory-cli.md");
              const contents = yield* fs.readFileString(projectPath);

              assert.strictEqual(created, true);
              assert.include(contents, "# agentic-memory-cli");
              assert.notInclude(contents, "[[notes/example]]");
              assert.notInclude(contents, "[[projects/example]]");
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("treats incidental project mentions as unhealthy until a dedicated route exists", () =>
    CoreContractsRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const vaultPath = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-core-route-health-",
              });

              yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), {
                recursive: true,
              });
              yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
                recursive: true,
              });
              yield* fs.writeFileString(
                path.join(vaultPath, "MEMORY.md"),
                `---
updated: 2026-06-01
---

# Memory

## Current

- Mention [[projects/agentic-memory-cli]] in prose only.
`,
              );
              yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
              yield* fs.writeFileString(
                path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
                "outside-vault contract",
              );
              yield* fs.writeFileString(
                path.join(vaultPath, "projects", "agentic-memory-cli.md"),
                "# agentic-memory-cli\n",
              );

              const health = yield* checkVaultHealth({
                vaultPath,
                projectSlug: yield* decodeProjectSlug("agentic-memory-cli"),
              });

              assert.strictEqual(health.memoryRouteExists, false);
              assert.strictEqual(health.healthy, false);
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("treats vaults missing session-capture guidance as unhealthy for steward capture", () =>
    CoreContractsRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const vaultPath = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-core-capture-health-",
              });

              yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), {
                recursive: true,
              });
              yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
                recursive: true,
              });
              yield* fs.writeFileString(
                path.join(vaultPath, "MEMORY.md"),
                `# Memory

## Projects

- [[projects/agentic-memory-cli]] — agentic-memory-cli.
`,
              );
              yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
              yield* fs.writeFileString(
                path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
                "outside-vault contract",
              );
              yield* fs.writeFileString(
                path.join(vaultPath, "projects", "agentic-memory-cli.md"),
                "# agentic-memory-cli\n",
              );

              const health = yield* checkVaultHealth({
                vaultPath,
                projectSlug: yield* decodeProjectSlug("agentic-memory-cli"),
              });

              assert.strictEqual(health.sessionCaptureInstructionsExists, false);
              assert.strictEqual(health.healthy, false);
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect("rejects link validation when session-capture guidance is missing", () =>
    CoreContractsRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const vaultPath = yield* fs.makeTempDirectoryScoped({
                prefix: "agentic-memory-core-link-health-",
              });

              yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), {
                recursive: true,
              });
              yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
                recursive: true,
              });
              yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
              yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
              yield* fs.writeFileString(
                path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
                "outside-vault contract",
              );

              const validation = yield* validateVaultForLink(vaultPath).pipe(Effect.exit);

              assert.strictEqual(validation._tag, "Failure");
            }),
          ),
          context,
        ),
      ),
    ),
  );

  it.effect(
    "rejects partial non-empty vaults instead of treating them as already initialized",
    () =>
      CoreContractsRuntime.contextEffect.pipe(
        Effect.flatMap((context) =>
          Effect.provideContext(
            Effect.scoped(
              Effect.gen(function* () {
                const fs = yield* FileSystem.FileSystem;
                const path = yield* Path.Path;
                const vaultPath = yield* fs.makeTempDirectoryScoped({
                  prefix: "agentic-memory-core-init-",
                });

                yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), {
                  recursive: true,
                });
                yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory", "adapters"), {
                  recursive: true,
                });
                yield* fs.makeDirectory(path.join(vaultPath, "projects"), {
                  recursive: true,
                });
                yield* fs.writeFileString(path.join(vaultPath, "AGENTS.md"), "# Agents\n");
                yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
                yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
                yield* fs.writeFileString(
                  path.join(vaultPath, ".agentic-memory", "LLM-vault-local.md"),
                  "vault-local contract",
                );
                yield* fs.writeFileString(
                  path.join(vaultPath, ".agentic-memory", "LLM-outside-vault.md"),
                  "outside-vault contract",
                );
                yield* fs.writeFileString(
                  path.join(vaultPath, ".agentic-memory", "adapters", "MEMORY_ADAPTER.md"),
                  "adapter",
                );

                const result = yield* initVaultFromTemplate({
                  targetPath: vaultPath,
                  initializeGit: false,
                  yes: false,
                }).pipe(Effect.exit);

                assert.strictEqual(result._tag, "Failure");
              }),
            ),
            context,
          ),
        ),
      ),
  );
});
