import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { extractAssistantText } from "@urban/agentic-memory-core/steward/PiProcessRunner";
import { Effect, Fiber, Layer, ManagedRuntime, Option } from "effect";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTURE_BATCH_SIZE, MARKER_VERSION } from "../../src/constants.ts";
import memoryCapture from "../../src/index.ts";
import { CaptureConfig } from "../../src/services/CaptureConfig.ts";
import { MemorySteward, StewardExecutor } from "../../src/services/MemorySteward.ts";
import { Markers } from "../../src/services/Markers.ts";
import { Preprocessor } from "../../src/services/Preprocessor.ts";
import { VaultProjects } from "../../src/services/VaultProjects.ts";
import { runCapturePass } from "../../src/workflows/capture.ts";
import { decodeAttemptId } from "../../src/markers/CaptureMarker.ts";
import { encodeProjectConfigJson } from "../../src/schema.ts";
import {
  createTempDirectory,
  makeAssistantEntry,
  makeCustomMarkerEntry,
  makeSessionManager,
  makeUserEntry,
  removeTempDirectory,
  writeFile,
} from "../helpers.ts";

type StewardDecisionReport =
  import("@urban/agentic-memory-core/steward/StewardResult").StewardDecisionReport;
type ExtensionAPI = import("@earendil-works/pi-coding-agent").ExtensionAPI;
type SessionEntry = import("@earendil-works/pi-coding-agent").SessionEntry;
type StewardRunResult = import("../../src/services/MemorySteward.ts").StewardRunResult;
type CapturePayload = import("../../src/schema.ts").CapturePayload;
type LoadConfigResult = import("../../src/schema.ts").LoadConfigResult;
type LocalPaths = import("../../src/schema.ts").LocalPaths;
type ResolvedProjectConfig = import("../../src/schema.ts").ResolvedProjectConfig;

const capturePayload: CapturePayload = {
  version: 1,
  projectSlug: "capture-extension",
  messages: [
    {
      role: "user",
      text: "hello",
    },
    {
      role: "assistant",
      text: "hi",
    },
  ],
};

const durableDecisionReport: StewardDecisionReport = {
  decisionSummary: "Durable project context should be written.",
  durability: "durable",
  selectedDestinations: [
    {
      target: "projects/capture-extension.md",
      memoryLayer: "project",
      reason: "The observation is project-specific resume context.",
    },
  ],
  skippedDestinations: [],
  durableSignals: ["Future sessions need this project context."],
  duplicateSignals: [],
  privacyNotes: ["No raw transcript text was stored."],
};

type StewardRun = (input: {
  readonly projectRoot: string;
  readonly payload: CapturePayload;
  readonly payloadWarnings: ReadonlyArray<string>;
  readonly timeoutMillis: number;
}) => Effect.Effect<StewardRunResult>;

const projectSlug = "capture-extension";

const makeCaptureConfigService = (cwd: string, vaultPath: string) => {
  const paths: LocalPaths = {
    directory: `${cwd}/.agentic-memory-link`,
    configFile: `${cwd}/.agentic-memory-link/config.json`,
  };
  const config: ResolvedProjectConfig = {
    version: 1,
    vaultPath,
    projectSlug,
  };
  const loadResult: LoadConfigResult = {
    _tag: "valid",
    paths,
    config,
  };

  return CaptureConfig.of({
    environmentOverrides: Effect.succeed({
      vaultOverride: undefined,
      cliBinary: undefined,
    }),
    localPaths: () => Effect.succeed(paths),
    load: () => Effect.succeed(loadResult),
    ensureLocalFiles: () => Effect.succeed(paths),
  });
};

const captureConfigLayer = CaptureConfig.layer.pipe(Layer.provideMerge(VaultProjects.layer));

const makeRuntimeLayer = (run: StewardRun) =>
  Layer.mergeAll(
    Layer.succeed(CaptureConfig, makeCaptureConfigService("/project", "/vault")),
    Markers.layer,
    Preprocessor.layer,
    Layer.succeed(
      MemorySteward,
      MemorySteward.of({
        run,
      }),
    ),
  );

const makeTurnEntries = (count: number): ReadonlyArray<SessionEntry> =>
  Array.from({ length: count }).flatMap((_, index) => {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    return [
      makeUserEntry(userId, `prompt ${index}`, index === 0 ? null : `a${index - 1}`),
      makeAssistantEntry(assistantId, [{ type: "text", text: `answer ${index}` }], userId),
    ];
  });

describe("MemorySteward", () => {
  it("stops decoding once it reaches the final assistant message", () => {
    const finalText = JSON.stringify({
      status: "captured",
      summary: "Record history",
    });
    const finalLine = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: finalText }],
      },
    });
    const output = [
      ...Array.from({ length: 500 }, (_, index) => `{"type":"message_update","delta":"${index}"}`),
      finalLine,
    ].join("\n");
    let decodedLines = 0;

    const extracted = extractAssistantText(output, (line: string) => {
      decodedLines += 1;

      return line === finalLine
        ? Option.some({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: finalText }],
            },
          })
        : Option.none();
    });

    expect(extracted).toBe(finalText);
    expect(decodedLines).toBe(1);
  });

  it("constructs the agentic-memory CLI command and decodes strict JSON", () => {
    const root = createTempDirectory("pi-memory-steward-");
    const projectRoot = join(root, "project");
    const seen: {
      command: string;
      args: ReadonlyArray<string>;
      cwd: string | undefined;
      timeout: number | undefined;
    }[] = [];

    const layer = MemorySteward.layer.pipe(
      Layer.provide(captureConfigLayer),
      Layer.provide(
        Layer.succeed(
          StewardExecutor,
          StewardExecutor.of({
            exec: (command, args, options) =>
              Effect.sync(() => {
                seen.push({
                  command,
                  args,
                  cwd: options?.cwd,
                  timeout: options?.timeout,
                });
                return {
                  code: 0,
                  stderr: "",
                  killed: false,
                  // @effect-diagnostics-next-line preferSchemaOverJson:off
                  stdout: `${JSON.stringify({
                    status: "succeeded",
                    result: {
                      status: "captured",
                      summary: "Record history",
                      filesChanged: ["projects/capture-extension.md"],
                      warnings: ["steward warning"],
                      decisionReport: durableDecisionReport,
                    },
                    execution: {
                      runner: "pi-process",
                      attempts: 1,
                    },
                    retryFailureReasons: [],
                    warnings: [],
                  })}\n`,
                };
              }),
          }),
        ),
      ),
      Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
    );
    const runtime = ManagedRuntime.make(layer);

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const steward = yield* MemorySteward;
          const attemptId = yield* decodeAttemptId("attempt-1");
          const result = yield* steward.run({
            projectRoot,
            payload: capturePayload,
            payloadWarnings: ["payload warning"],
            timeoutMillis: 12_000,
            captureRunId: "run-1",
            attemptId,
            triggerKind: "agent_end",
            projectSlug,
          });

          expect(result._tag).toBe("Succeeded");
          if (result._tag === "Succeeded") {
            expect(result.result.status).toBe("captured");
            expect(result.result.filesChanged).toEqual(["projects/capture-extension.md"]);
            expect(result.result.warnings).toContain("steward warning");
          }
          expect(seen[0]?.command).toBe("agentic-memory");
          expect(seen[0]?.args).toContain("run-steward");
          expect(seen[0]?.args).toContain("--payload");
          expect(seen[0]?.args).toContain("--project-root");
          expect(seen[0]?.args).toContain(projectRoot);
          expect(seen[0]?.args).toContain("--json");
          expect(seen[0]?.args).toContain("--timeout-ms");
          expect(seen[0]?.args).toContain("--capture-attempt-id");
          expect(seen[0]?.args).toContain("attempt-1");
          expect(seen[0]?.args).toContain("--capture-run-id");
          expect(seen[0]?.args).toContain("run-1");
          expect(seen[0]?.args).toContain("--capture-trigger-kind");
          expect(seen[0]?.args).toContain("agent_end");
          expect(seen[0]?.args).toContain("--capture-project-slug");
          expect(seen[0]?.args).toContain(projectSlug);
          expect(seen[0]?.cwd).toBe(projectRoot);
          expect(seen[0]?.timeout).toBe(17_000);
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });

  it("aborts the steward exec when the run fiber is interrupted", () => {
    const root = createTempDirectory("pi-memory-steward-abort-");
    const vault = join(root, "vault");
    let aborted = false;
    let execStarted = false;
    let seenSignal: AbortSignal | undefined;

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");

    const layer = MemorySteward.layer.pipe(
      Layer.provide(Layer.succeed(CaptureConfig, makeCaptureConfigService("/project", vault))),
      Layer.provide(
        Layer.succeed(
          StewardExecutor,
          StewardExecutor.of({
            exec: (_command, _args, options) =>
              Effect.gen(function* () {
                yield* Effect.sync(() => {
                  execStarted = true;
                  seenSignal = options?.signal;
                  seenSignal?.addEventListener(
                    "abort",
                    () => {
                      aborted = true;
                    },
                    { once: true },
                  );
                });

                return yield* Effect.never;
              }),
          }),
        ),
      ),
      Layer.provide(BunFileSystem.layer),
    );
    const runtime = ManagedRuntime.make(layer);

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const steward = yield* MemorySteward;
          const attemptId = yield* decodeAttemptId("attempt-1");
          const fiber = yield* Effect.forkChild(
            steward.run({
              projectRoot: vault,
              payload: capturePayload,
              payloadWarnings: [],
              timeoutMillis: 12_000,
              captureRunId: "run-1",
              attemptId,
              triggerKind: "session_shutdown",
              projectSlug,
            }),
          );

          let spins = 0;
          while (!execStarted && spins < 1_000) {
            spins += 1;
            yield* Effect.yieldNow;
          }
          yield* Fiber.interrupt(fiber);

          expect(execStarted).toBe(true);
          expect(seenSignal).toBeDefined();
          expect(aborted).toBe(true);
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });

  it("cancels session_before_tree capture when tree preparation is aborted", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const root = createTempDirectory("pi-memory-tree-abort-");
        const projectRoot = join(root, "project");
        const vaultRoot = join(root, "vault");
        const appendedEntries: string[] = [];
        let execStarted = false;
        const handlers = new Map<string, Function>();

        const api = {
          on: (event, handler) => {
            handlers.set(event, handler);
          },
          registerTool: () => undefined,
          registerCommand: () => undefined,
          registerShortcut: () => undefined,
          registerFlag: () => undefined,
          getFlag: () => undefined,
          registerMessageRenderer: () => undefined,
          sendMessage: () => undefined,
          sendUserMessage: () => undefined,
          appendEntry: (customType) => {
            appendedEntries.push(customType);
          },
          setSessionName: () => undefined,
          getSessionName: () => undefined,
          setLabel: () => undefined,
          exec: (_command, _args, options) => {
            execStarted = true;
            const deferred = Promise.withResolvers<{
              readonly stdout: string;
              readonly stderr: string;
              readonly code: number;
              readonly killed: boolean;
            }>();
            const onAbort = () =>
              deferred.resolve({
                stdout: "",
                stderr: "",
                code: 143,
                killed: true,
              });

            if (options?.signal?.aborted === true) {
              onAbort();
            } else {
              options?.signal?.addEventListener("abort", onAbort, { once: true });
            }

            return deferred.promise.finally(() => {
              options?.signal?.removeEventListener("abort", onAbort);
            });
          },
          getActiveTools: () => [],
          getAllTools: () => [],
          setActiveTools: () => undefined,
          getCommands: () => [],
          setModel: () => Promise.resolve(false),
          getThinkingLevel: () => "medium",
          setThinkingLevel: () => undefined,
          registerProvider: () => undefined,
          unregisterProvider: () => undefined,
          events: {
            emit: () => undefined,
            on: () => () => undefined,
          },
        } satisfies ExtensionAPI;

        memoryCapture(api);

        const beforeTreeHandler = handlers.get("session_before_tree");
        const shutdownHandler = handlers.get("session_shutdown");

        expect(beforeTreeHandler).toBeDefined();
        expect(shutdownHandler).toBeDefined();
        if (beforeTreeHandler === undefined || shutdownHandler === undefined) {
          throw new Error("Expected session capture handlers to be registered");
        }

        writeFile(join(vaultRoot, "MEMORY.md"), "# Memory");
        writeFile(join(vaultRoot, "USER.md"), "# User");
        writeFile(join(vaultRoot, "projects", ".keep"), "");
        writeFile(join(vaultRoot, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
        writeFile(
          join(vaultRoot, ".agentic-memory", "instructions", "session-capture.md"),
          "# capture",
        );
        const configJson = yield* encodeProjectConfigJson({
          version: 1,
          vaultPath: vaultRoot,
          projectSlug,
        });
        writeFile(join(projectRoot, ".agentic-memory-link", "config.json"), `${configJson}\n`);

        const ctx = {
          ui: {
            notify: () => undefined,
          },
          hasUI: false,
          cwd: projectRoot,
          sessionManager: makeSessionManager(makeTurnEntries(1)),
          modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory()),
          model: undefined,
          isIdle: () => true,
          signal: undefined,
          abort: () => undefined,
          hasPendingMessages: () => false,
          shutdown: () => undefined,
          getContextUsage: () => undefined,
          compact: () => undefined,
          getSystemPrompt: () => "",
        };
        const cleanupCtx = {
          ...ctx,
          sessionManager: makeSessionManager([]),
        };
        const controller = new AbortController();

        yield* Effect.gen(function* () {
          const captureFiber = yield* Effect.forkChild(
            Effect.promise(() =>
              Promise.resolve(
                beforeTreeHandler(
                  {
                    type: "session_before_tree",
                    preparation: {
                      targetId: "leaf-1",
                      oldLeafId: "leaf-0",
                      commonAncestorId: "a0",
                      entriesToSummarize: [],
                      userWantsSummary: true,
                    },
                    signal: controller.signal,
                  },
                  ctx,
                ),
              ),
            ),
          );

          let spins = 0;
          while (!execStarted && spins < 1_000) {
            spins += 1;
            yield* Effect.yieldNow;
          }

          expect(execStarted).toBe(true);
          yield* Effect.sync(() => controller.abort());

          const status = yield* Effect.raceFirst(
            Fiber.join(captureFiber).pipe(Effect.as("settled")),
            Effect.sleep(150).pipe(Effect.as("pending")),
          );

          expect(status).toBe("settled");
          expect(appendedEntries).toHaveLength(0);
        }).pipe(
          Effect.ensuring(
            Effect.promise(() =>
              Promise.resolve(
                shutdownHandler(
                  {
                    type: "session_shutdown",
                    reason: "reload",
                  },
                  cleanupCtx,
                ),
              ),
            ),
          ),
          Effect.ensuring(Effect.sync(() => removeTempDirectory(root))),
        );
      }),
    ));
});

describe("runtime capture flow", () => {
  it("gates agent_end capture by the schedule anchor batch size", () => {
    const cwd = "/project";
    const branch = makeTurnEntries(CAPTURE_BATCH_SIZE - 1);
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          _tag: "Failed",
          retryFailureReasons: [],
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            branch,
            triggerKind: "agent_end",
            timeoutMillis: 20_000,
            force: false,
          });

          expect(execution.status).toBe("below_threshold");
          expect(execution.markers).toHaveLength(0);
        }),
      )
      .finally(() => runtime.dispose());
  });

  it("writes observation then schedule markers on successful capture", () => {
    const cwd = "/project";
    const branch = makeTurnEntries(CAPTURE_BATCH_SIZE);
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          _tag: "Succeeded",
          result: {
            status: "captured",
            summary: "Record project history",
            filesChanged: ["projects/capture-extension.md"],
            warnings: [],
            decisionReport: durableDecisionReport,
          },
          retryFailureReasons: [],
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            branch,
            triggerKind: "agent_end",
            timeoutMillis: 20_000,
            force: false,
          });

          expect(execution.status).toBe("captured");
          expect(execution.markers.map((marker) => marker.kind)).toEqual([
            "observation_result",
            "schedule_result",
          ]);
          expect(execution.markers[0]?.markerVersion).toBe(MARKER_VERSION);
          expect(execution.markers[1]?.kind).toBe("schedule_result");
          if (execution.markers[1]?.kind === "schedule_result") {
            expect(execution.markers[1].sendStatus).toBe("succeeded");
            expect(execution.markers[1].retryFailureReasons).toEqual([]);
          }
          expect(execution.decisionReport?.durability).toBe("durable");
          expect(execution.markers.some((marker) => "decisionReport" in marker)).toBe(false);
        }),
      )
      .finally(() => runtime.dispose());
  });

  it("keeps omitted tail messages eligible after a truncated successful capture", () => {
    const cwd = "/project";
    const branch = makeTurnEntries(CAPTURE_BATCH_SIZE * 4 + 1);
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          _tag: "Succeeded",
          result: {
            status: "captured",
            summary: "Record project history",
            filesChanged: ["projects/capture-extension.md"],
            warnings: [],
            decisionReport: durableDecisionReport,
          },
          retryFailureReasons: [],
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            branch,
            triggerKind: "agent_end",
            timeoutMillis: 20_000,
            force: false,
          });
          const markers = yield* Markers;
          const branchWithMarkers = [
            ...branch,
            makeCustomMarkerEntry("o1", execution.markers[0], "a40"),
            makeCustomMarkerEntry("s1", execution.markers[1], "o1"),
          ];
          const nextSelection = yield* markers.selectObservation(branchWithMarkers);
          const turnsAfterSchedule =
            yield* markers.completedAssistantTurnsAfterSchedule(branchWithMarkers);

          expect(execution.status).toBe("captured");
          expect(execution.markers[0]?.observation.toEntryId).toBe("a39");
          expect(execution.markers[0]?.observation.entryCount).toBe(80);
          expect(nextSelection.capturableMessages.map((entry) => entry.id)).toEqual(["u40", "a40"]);
          expect(turnsAfterSchedule).toBe(1);
        }),
      )
      .finally(() => runtime.dispose());
  });

  it("overlaps observation after no_changes while resetting the schedule anchor", () => {
    const cwd = "/project";
    const existingObservation = {
      fromEntryId: "u0",
      toEntryId: "a0",
      entryCount: 2,
      messageCount: 2,
    };
    const branch = [
      makeUserEntry("u0", "first"),
      makeAssistantEntry("a0", [{ type: "text", text: "first answer" }], "u0"),
      makeCustomMarkerEntry("o1", {
        markerVersion: MARKER_VERSION,
        kind: "observation_result",
        attemptId: "attempt-1",
        timestamp: "2026-06-05T12:00:00.000Z",
        triggerKind: "agent_end",
        observation: existingObservation,
        observationStatus: "no_changes",
      }),
      makeCustomMarkerEntry("s1", {
        markerVersion: MARKER_VERSION,
        kind: "schedule_result",
        attemptId: "attempt-1",
        timestamp: "2026-06-05T12:00:00.000Z",
        triggerKind: "agent_end",
        observation: existingObservation,
        sendStatus: "succeeded",
        retryFailureReasons: [],
      }),
      makeUserEntry("u1", "second", "s1"),
      makeAssistantEntry("a1", [{ type: "text", text: "second answer" }], "u1"),
    ];
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          _tag: "Succeeded",
          result: {
            status: "captured",
            summary: "Record overlapped history",
            filesChanged: [],
            warnings: [],
            decisionReport: durableDecisionReport,
          },
          retryFailureReasons: [],
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            branch,
            triggerKind: "session_shutdown",
            timeoutMillis: 8_000,
            force: true,
          });

          expect(execution.status).toBe("captured");
          expect(execution.markers[0]?.observation.fromEntryId).toBe("u0");
        }),
      )
      .finally(() => runtime.dispose());
  });

  it("records only a failed schedule marker when the steward cannot be reached", () => {
    const cwd = "/project";
    const branch = makeTurnEntries(1);
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          _tag: "Failed",
          retryFailureReasons: [
            "Timed out waiting for steward final JSON after child process launch",
            "Steward returned EOF before final assistant JSON response was emitted",
            "Steward process exited with non-zero status before emitting final JSON",
          ],
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            branch,
            triggerKind: "session_shutdown",
            timeoutMillis: 8_000,
            force: true,
          });

          expect(execution.status).toBe("failed");
          expect(execution.markers).toHaveLength(1);
          expect(execution.markers[0]?.kind).toBe("schedule_result");
          if (execution.markers[0]?.kind === "schedule_result") {
            expect(execution.markers[0].sendStatus).toBe("failed");
            expect(execution.markers[0].retryFailureReasons).toHaveLength(3);
          }
        }),
      )
      .finally(() => runtime.dispose());
  });
});
