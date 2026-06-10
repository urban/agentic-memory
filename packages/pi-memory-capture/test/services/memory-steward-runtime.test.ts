import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Fiber, Layer, ManagedRuntime, Option } from "effect";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKER_VERSION, PACKAGE_VERSION } from "../../src/constants.ts";
import { checkpointFromForkPosition, runCapturePass } from "../../src/runtime.ts";
import {
  extractAssistantText,
  MemorySteward,
  StewardExecutor,
  type StewardRunResult,
} from "../../src/services/MemorySteward.ts";
import { Config } from "../../src/services/Config.ts";
import { Markers } from "../../src/services/Markers.ts";
import { Preprocessor } from "../../src/services/Preprocessor.ts";
import { ScratchpadStore } from "../../src/services/Scratchpad.ts";
import {
  decodeScratchpadJson,
  encodeScratchpadJson,
  type CapturePayload,
  type ScratchpadCandidate,
} from "../../src/schema.ts";
import { emptyScratchpad } from "../../src/scratchpad.ts";
import {
  createTempDirectory,
  makeAssistantEntry,
  makeCustomMarkerEntry,
  makeSessionManager,
  makeUserEntry,
  removeTempDirectory,
  writeFile,
} from "../helpers.ts";

const capturePayload: CapturePayload = {
  version: 1,
  checkpoint: "manual",
  project: {
    projectLink: "[[projects/capture-extension]]",
    projectLabel: "capture-extension",
  },
  observation: {
    fromEntryId: "u1",
    toEntryId: "a1",
    entryCount: 2,
  },
  messages: [
    {
      entryId: "u1",
      role: "user",
      text: "hello",
      truncated: false,
    },
  ],
  scratchpad: emptyScratchpad("[[projects/capture-extension]]", "2026-06-05T12:00:00.000Z"),
};

type StewardRun = (input: {
  readonly vaultPath: string;
  readonly payload: CapturePayload;
  readonly payloadWarnings: ReadonlyArray<string>;
  readonly timeoutMillis: number;
}) => Effect.Effect<StewardRunResult>;

const projectLink = "[[projects/capture-extension]]";

const makeConfigService = (cwd: string, vaultPath: string) => {
  const paths = {
    directory: `${cwd}/.pi/agentic-memory-capture`,
    configFile: `${cwd}/.pi/agentic-memory-capture/config.json`,
    scratchpadFile: `${cwd}/.pi/agentic-memory-capture/scratchpad.json`,
  };
  const config: {
    readonly version: 1;
    readonly vaultPath: string;
    readonly projectLink: string;
  } = {
    version: 1,
    vaultPath,
    projectLink,
  };
  const loadResult: {
    readonly _tag: "valid";
    readonly paths: typeof paths;
    readonly config: typeof config;
  } = {
    _tag: "valid",
    paths,
    config,
  };

  return Config.of({
    environmentOverrides: Effect.succeed({
      vaultOverride: undefined,
      piBinary: undefined,
    }),
    localPaths: () => Effect.succeed(paths),
    load: () => Effect.succeed(loadResult),
    validateInputs: (nextVaultPath, nextProjectLink) =>
      Effect.succeed({
        version: 1,
        vaultPath: nextVaultPath,
        projectLink: nextProjectLink,
      }),
    projectFilePath: () => Effect.succeed(`${vaultPath}/projects/capture-extension.md`),
    projectExists: () => Effect.succeed(true),
    ensureLocalFiles: () => Effect.succeed(paths),
    ensureProjectFile: () => Effect.succeed(false),
    ensureMemoryRoute: () => Effect.succeed(false),
    ensureGitExcludeEntry: () => Effect.succeed(false),
  });
};

const makeRuntimeLayer = (run: StewardRun) =>
  Layer.mergeAll(
    Config.layer,
    ScratchpadStore.layer,
    Markers.layer,
    Preprocessor.layer,
    Layer.succeed(
      MemorySteward,
      MemorySteward.of({
        run,
      }),
    ),
  ).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

describe("MemorySteward", () => {
  it("stops decoding once it reaches the final assistant message", () => {
    const finalText = JSON.stringify({
      status: "captured",
      summary: "Stored history.",
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

    const extracted = extractAssistantText(output, (line) => {
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

  it("constructs the pi command and tolerates invalid scratchpad payloads", () => {
    const root = createTempDirectory("pi-memory-steward-");
    const vault = join(root, "vault");
    const seen: {
      command: string;
      args: ReadonlyArray<string>;
      cwd: string | undefined;
      timeout: number | undefined;
    }[] = [];

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");

    const layer = MemorySteward.layer.pipe(
      Layer.provide(Config.layer),
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
                    type: "message_end",
                    message: {
                      role: "assistant",
                      content: [
                        {
                          type: "text",
                          // @effect-diagnostics-next-line preferSchemaOverJson:off
                          text: JSON.stringify({
                            status: "captured",
                            summary: "Stored history.",
                            filesChanged: ["projects/capture-extension.md"],
                            warnings: ["steward warning"],
                            scratchpad: {
                              invalid: true,
                            },
                          }),
                        },
                      ],
                    },
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
          const result = yield* steward.run({
            vaultPath: vault,
            payload: capturePayload,
            payloadWarnings: ["payload warning"],
            timeoutMillis: 12_000,
          });

          expect(result.status).toBe("captured");
          expect(result.scratchpad).toBeUndefined();
          expect(result.warnings).toContain("steward warning");
          expect(result.warnings.some((warning) => warning.includes("invalid scratchpad"))).toBe(
            true,
          );
          expect(seen[0]?.command).toBe("pi");
          expect(seen[0]?.args).toContain("--mode");
          expect(seen[0]?.args).toContain("json");
          expect(seen[0]?.args).toContain("--append-system-prompt");
          expect(seen[0]?.args).toContain("# contract");
          expect(seen[0]?.cwd).toBe(vault);
          expect(seen[0]?.timeout).toBe(12_000);
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
      Layer.provide(Layer.succeed(Config, makeConfigService("/project", vault))),
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
          const fiber = yield* Effect.forkChild(
            steward.run({
              vaultPath: vault,
              payload: capturePayload,
              payloadWarnings: [],
              timeoutMillis: 12_000,
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
});

describe("runtime capture flow", () => {
  it("keeps both candidate updates when capture passes overlap", () => {
    const cwd = "/project";
    let scratchpadState = emptyScratchpad(projectLink, "2026-06-05T12:00:00.000Z");
    let startedRuns = 0;
    const branch: ReadonlyArray<SessionEntry> = [
      makeUserEntry("u1", "Discuss the capture extension."),
      makeAssistantEntry(
        "a1",
        [{ type: "text", text: "We should preserve the decision log." }],
        "u1",
      ),
    ];

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Layer.succeed(Config, makeConfigService(cwd, "/vault")),
        Layer.succeed(
          Markers,
          Markers.of({
            latestAdvancingMarker: () => Effect.void.pipe(Effect.as(undefined)),
            latestFailureMarker: () => Effect.void.pipe(Effect.as(undefined)),
            selectObservation: () =>
              Effect.succeed({
                latestAdvancingMarker: undefined,
                observedEntries: branch,
                capturableMessages: [],
              }),
          }),
        ),
        Layer.succeed(
          Preprocessor,
          Preprocessor.of({
            buildPayload: (checkpoint, nextProjectLink, observedEntries, scratchpad) =>
              Effect.succeed({
                _tag: "Payload",
                payload: {
                  version: 1,
                  checkpoint,
                  project: {
                    projectLink: nextProjectLink,
                    projectLabel: "capture-extension",
                  },
                  observation: {
                    fromEntryId: observedEntries[0]?.id ?? "u1",
                    toEntryId: observedEntries[observedEntries.length - 1]?.id ?? "a1",
                    entryCount: observedEntries.length,
                  },
                  messages: [
                    {
                      entryId: "u1",
                      role: "user",
                      text: "hello",
                      truncated: false,
                    },
                  ],
                  scratchpad,
                },
                warnings: [],
              }),
          }),
        ),
        Layer.succeed(
          ScratchpadStore,
          ScratchpadStore.of({
            load: () =>
              Effect.succeed({
                scratchpad: scratchpadState,
                warnings: [],
              }),
            write: (_filepath, scratchpad) =>
              Effect.sync(() => {
                scratchpadState = scratchpad;
                return scratchpad;
              }),
          }),
        ),
        Layer.succeed(
          MemorySteward,
          MemorySteward.of({
            run: Effect.fn("TestMemorySteward.run")(function* (input) {
              startedRuns += 1;
              const callNumber = startedRuns;
              let spins = 0;

              while (startedRuns < 2 && spins < 1_000) {
                spins += 1;
                yield* Effect.yieldNow;
              }

              const nextCandidate: ScratchpadCandidate =
                callNumber === 1
                  ? {
                      id: "candidate-a",
                      kind: "project_decision",
                      summary: "Preserve the decision log.",
                      evidenceCount: 1,
                      firstSeenAt: "2026-06-05T12:10:00.000Z",
                      lastSeenAt: "2026-06-05T12:10:00.000Z",
                      confidence: "high",
                      nextAction: "promote",
                      reasonNotPromoted: "",
                    }
                  : {
                      id: "candidate-b",
                      kind: "resume_context",
                      summary: "Resume from the capture discussion.",
                      evidenceCount: 1,
                      firstSeenAt: "2026-06-05T12:11:00.000Z",
                      lastSeenAt: "2026-06-05T12:11:00.000Z",
                      confidence: "medium",
                      nextAction: "wait",
                      reasonNotPromoted: "",
                    };

              return {
                status: "captured",
                summary: "Stored project history.",
                filesChanged: [],
                warnings: [],
                scratchpad: {
                  ...input.payload.scratchpad,
                  updatedAt:
                    callNumber === 1 ? "2026-06-05T12:10:00.000Z" : "2026-06-05T12:11:00.000Z",
                  pendingCandidates: [...input.payload.scratchpad.pendingCandidates, nextCandidate],
                },
              };
            }),
          }),
        ),
      ),
    );

    return Promise.all([
      runtime.runPromise(
        runCapturePass({
          cwd,
          sessionManager: makeSessionManager(branch),
          checkpoint: "manual",
          timeoutMillis: 20_000,
          mode: "manual",
        }),
      ),
      runtime.runPromise(
        runCapturePass({
          cwd,
          sessionManager: makeSessionManager(branch),
          checkpoint: "session_before_tree",
          timeoutMillis: 20_000,
          mode: "automatic",
        }),
      ),
    ])
      .then(() => {
        expect(scratchpadState.pendingCandidates.map((candidate) => candidate.id)).toEqual([
          "candidate-a",
          "candidate-b",
        ]);
      })
      .finally(() => runtime.dispose());
  });

  it("writes local scratchpad state for captured results", () => {
    const root = createTempDirectory("pi-memory-runtime-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");
    const scratchpadPath = join(cwd, ".pi", "agentic-memory-capture", "scratchpad.json");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(cwd, ".pi", "agentic-memory-capture", "config.json"),
      `{"version":1,"vaultPath":"${vault}","projectLink":"[[projects/capture-extension]]","projectRoot":"${cwd}"}`,
    );
    writeFile(
      scratchpadPath,
      Effect.runSync(
        encodeScratchpadJson(
          emptyScratchpad("[[projects/capture-extension]]", "2026-06-05T12:00:00.000Z"),
        ),
      ),
    );

    const branch = [
      makeUserEntry("u1", "Discuss the capture extension."),
      makeAssistantEntry(
        "a1",
        [{ type: "text", text: "We should preserve the decision log." }],
        "u1",
      ),
    ];
    const capturedLayer = makeRuntimeLayer(() =>
      Effect.succeed({
        status: "captured",
        summary: "Stored project history.",
        filesChanged: ["projects/capture-extension.md"],
        warnings: [],
        scratchpad: {
          version: 1,
          projectLink: "[[projects/capture-extension]]",
          updatedAt: "2026-06-05T12:10:00.000Z",
          pendingCandidates: [
            {
              id: "candidate-1",
              kind: "project_decision",
              summary: "Preserve the project decision log.",
              evidenceCount: 2,
              firstSeenAt: "2026-06-05T12:10:00.000Z",
              lastSeenAt: "2026-06-05T12:10:00.000Z",
              confidence: "high",
              nextAction: "promote",
              reasonNotPromoted: "",
            },
          ],
        },
      }),
    );
    const capturedRuntime = ManagedRuntime.make(capturedLayer);

    return capturedRuntime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            sessionManager: makeSessionManager(branch),
            checkpoint: "manual",
            timeoutMillis: 20_000,
            mode: "manual",
          });
          const decoded = yield* decodeScratchpadJson(readFileSync(scratchpadPath, "utf8"));

          expect(execution.status).toBe("captured");
          expect(execution.marker?.status).toBe("captured");
          expect(execution.changedFiles).toEqual(["projects/capture-extension.md"]);
          expect(decoded.pendingCandidates).toHaveLength(1);
          expect(decoded.pendingCandidates[0]?.summary).toContain("decision");
        }),
      )
      .finally(() =>
        Promise.all([capturedRuntime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });

  it("fails open for missing config in automatic mode", () => {
    const cwd = createTempDirectory("pi-memory-runtime-missing-");
    const missingConfigLayer = makeRuntimeLayer(() =>
      Effect.succeed({
        status: "captured",
        summary: "unused",
        filesChanged: [],
        warnings: [],
        scratchpad: undefined,
      }),
    );
    const missingConfigRuntime = ManagedRuntime.make(missingConfigLayer);

    return missingConfigRuntime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            sessionManager: makeSessionManager([]),
            checkpoint: "session_shutdown",
            timeoutMillis: 8_000,
            mode: "automatic",
          });

          expect(execution.status).toBe("ignored");
          expect(execution.marker).toBeUndefined();
        }),
      )
      .finally(() =>
        Promise.all([
          missingConfigRuntime.dispose(),
          Promise.resolve(removeTempDirectory(cwd)),
        ]).then(() => undefined),
      );
  });

  it("treats marker-only observations as no new entries", () => {
    const root = createTempDirectory("pi-memory-runtime-marker-only-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(cwd, ".pi", "agentic-memory-capture", "config.json"),
      `{"version":1,"vaultPath":"${vault}","projectLink":"[[projects/capture-extension]]","projectRoot":"${cwd}"}`,
    );

    const branch = [
      makeUserEntry("u1", "Discuss the capture extension."),
      makeCustomMarkerEntry("m1", {
        version: PACKAGE_VERSION,
        markerVersion: MARKER_VERSION,
        status: "captured",
        checkpoint: "manual",
        lastObservedEntryId: "u1",
        observation: {
          fromEntryId: "u1",
          toEntryId: "u1",
          entryCount: 1,
        },
        timestamp: "2026-06-05T12:00:00.000Z",
        summary: "Stored project history.",
      }),
    ];
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          status: "captured",
          summary: "unused",
          filesChanged: [],
          warnings: [],
          scratchpad: undefined,
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            sessionManager: makeSessionManager(branch),
            checkpoint: "session_before_tree",
            timeoutMillis: 12_000,
            mode: "automatic",
          });

          expect(execution.status).toBe("no_new_entries");
          expect(execution.marker).toBeUndefined();
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });

  it("records a failed marker when the steward returns a failed result", () => {
    const root = createTempDirectory("pi-memory-runtime-failed-result-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(cwd, ".pi", "agentic-memory-capture", "config.json"),
      `{"version":1,"vaultPath":"${vault}","projectLink":"[[projects/capture-extension]]","projectRoot":"${cwd}"}`,
    );
    writeFile(
      join(cwd, ".pi", "agentic-memory-capture", "scratchpad.json"),
      Effect.runSync(
        encodeScratchpadJson(
          emptyScratchpad("[[projects/capture-extension]]", "2026-06-05T12:00:00.000Z"),
        ),
      ),
    );

    const branch = [makeUserEntry("u1", "Capture failed due to invalid output.")];
    const runtime = ManagedRuntime.make(
      makeRuntimeLayer(() =>
        Effect.succeed({
          status: "failed",
          summary: "Memory Steward rejected the payload.",
          filesChanged: [],
          warnings: [],
          scratchpad: undefined,
        }),
      ),
    );

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const execution = yield* runCapturePass({
            cwd,
            sessionManager: makeSessionManager(branch),
            checkpoint: "manual",
            timeoutMillis: 20_000,
            mode: "manual",
          });

          expect(execution.status).toBe("failed");
          expect(execution.marker?.status).toBe("failed");
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });

  it("maps fork positions to distinct checkpoints", () => {
    expect(checkpointFromForkPosition("before")).toBe("session_before_fork");
    expect(checkpointFromForkPosition("at")).toBe("session_before_clone");
  });
});
