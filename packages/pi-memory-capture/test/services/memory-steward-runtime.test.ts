import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, ManagedRuntime } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkpointFromForkPosition, runCapturePass } from "../../src/runtime.ts";
import {
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
  encodeProjectConfigJson,
  encodeScratchpadJson,
  type CapturePayload,
} from "../../src/schema.ts";
import { emptyScratchpad } from "../../src/scratchpad.ts";
import {
  createTempDirectory,
  makeAssistantEntry,
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
});

describe("runtime capture flow", () => {
  it("writes local scratchpad state for captured results", () => {
    const root = createTempDirectory("pi-memory-runtime-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");
    const scratchpadPath = join(cwd, ".pi", "agentic-memory-capture", "scratchpad.json");

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(
      join(cwd, ".pi", "agentic-memory-capture", "config.json"),
      Effect.runSync(
        encodeProjectConfigJson({
          version: 1,
          vaultPath: vault,
          projectLink: "[[projects/capture-extension]]",
        }),
      ),
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

  it("maps fork positions to distinct checkpoints", () => {
    expect(checkpointFromForkPosition("before")).toBe("session_before_fork");
    expect(checkpointFromForkPosition("at")).toBe("session_before_clone");
  });
});
