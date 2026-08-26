import * as BunServices from "@effect/platform-bun/BunServices";
import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { encodeLinkConfigJson } from "@urban/agentic-memory-core/link/LinkConfig";
type LinkConfig = import("@urban/agentic-memory-core/link/LinkConfig").LinkConfig;
import { Effect, FileSystem, Layer, ManagedRuntime } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { theme } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { describe, expect, it } from "vitest";
import { runInitCommand } from "../../src/initialization.ts";
import { CaptureConfig } from "../../src/services/CaptureConfig.ts";
import { Markers } from "../../src/services/Markers.ts";
import { applyInitialization, planInitialization } from "../../src/workflows/initialization.ts";
import { loadStatus } from "../../src/workflows/status.ts";
import {
  createTempDirectory,
  joinPath as join,
  makeCustomMarkerEntry,
  removeTempDirectory,
  writeFile,
} from "../helpers.ts";

type ExtensionCommandContext = import("@earendil-works/pi-coding-agent").ExtensionCommandContext;
const captureConfigLayer = CaptureConfig.layer;
const runtimeLayer = Layer.mergeAll(captureConfigLayer, Markers.layer).pipe(
  Layer.provideMerge(BunServices.layer),
);

const initializeGitRepository = Effect.fnUntraced(function* (cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("git", ["init"], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
    }),
  );

  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* Effect.die(new Error("Failed to initialize the test Git repository"));
  }
});

const makeCommandContext = (cwd: string) =>
  ({
    ui: {
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
      input: () => Promise.resolve(undefined),
      notify: () => {},
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: () => Promise.reject(new Error("Unexpected custom UI request")),
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      editor: () => Promise.resolve(undefined),
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => {},
      theme,
      getAllThemes: () => [],
      getTheme: () => {},
      setTheme: () => ({ success: false, error: "Theme switching is unavailable in tests" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    },
    hasUI: false,
    cwd,
    sessionManager: SessionManager.inMemory(cwd),
    modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory()),
    model: undefined,
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => {},
    compact: () => {},
    getSystemPrompt: () => "",
    waitForIdle: () => Promise.resolve(),
    newSession: () => Promise.resolve({ cancelled: false }),
    fork: () => Promise.resolve({ cancelled: false }),
    navigateTree: () => Promise.resolve({ cancelled: false }),
    switchSession: () => Promise.resolve({ cancelled: false }),
    reload: () => Promise.resolve(),
  }) satisfies ExtensionCommandContext;

describe("initialization status flow", () => {
  it("accepts the documented project wiki-link argument format", () => {
    const root = createTempDirectory("pi-memory-init-link-");
    const cwd = join(root, "project");
    const vault = join(root, "vault");
    const configFile = join(cwd, ".agentic-memory-link", "config.json");
    const projectFile = join(vault, "projects", "capture-extension.md");
    const runtime = ManagedRuntime.make(runtimeLayer);

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(join(vault, ".agentic-memory", "instructions", "session-capture.md"), "# capture");
    writeFile(join(vault, "USER.md"), "# User\n");
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
    writeFile(projectFile, "# Capture Extension\n");

    return runtime
      .runPromise(
        Effect.gen(function* () {
          yield* runInitCommand(`${vault} [[projects/capture-extension]]`, makeCommandContext(cwd));

          const config = yield* CaptureConfig;
          const loaded = yield* config.load(cwd);

          expect(loaded._tag).toBe("valid");
          if (loaded._tag === "valid") {
            expect(loaded.paths.configFile).toBe(configFile);
            expect(loaded.config.vaultPath).toBe(vault);
            expect(loaded.config.projectSlug).toBe("capture-extension");
          }
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(() => {}),
      );
  });

  it("writes link config and status reports latest branch-local markers", () => {
    const root = createTempDirectory("pi-memory-init-status-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".agentic-memory-link");
    const vault = join(root, "vault");
    const config: LinkConfig = {
      version: 1,
      vaultPath: vault,
      projectSlug: "capture-extension",
    };

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
    writeFile(join(vault, ".agentic-memory", "instructions", "session-capture.md"), "# capture");
    writeFile(join(vault, "USER.md"), "# User\n");
    writeFile(join(vault, "projects", ".gitkeep"), "");
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
    writeFile(
      join(localDirectory, "config.json"),
      `${Effect.runSync(encodeLinkConfigJson(config))}\n`,
    );
    const branch = [
      makeCustomMarkerEntry("o1", {
        markerVersion: 1,
        kind: "observation_result",
        attemptId: "attempt-1",
        timestamp: "2026-06-05T12:00:00.000Z",
        triggerKind: "agent_end",
        observation: {
          fromEntryId: "u1",
          toEntryId: "a1",
          entryCount: 2,
          messageCount: 2,
        },
        observationStatus: "captured",
        summary: "Record capture setup",
      }),
      makeCustomMarkerEntry("s1", {
        markerVersion: 1,
        kind: "schedule_result",
        attemptId: "attempt-1",
        timestamp: "2026-06-05T12:00:00.000Z",
        triggerKind: "agent_end",
        observation: {
          fromEntryId: "u1",
          toEntryId: "a1",
          entryCount: 2,
          messageCount: 2,
        },
        sendStatus: "succeeded",
        retryFailureReasons: [],
      }),
    ];
    const runtime = ManagedRuntime.make(runtimeLayer);

    return runtime
      .runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* initializeGitRepository(cwd);
          const creationPlan = yield* planInitialization({
            cwd,
            vaultPath: vault,
            projectSlug: "capture-extension",
          });
          const firstInitialization = yield* applyInitialization(cwd, config);
          const reusePlan = yield* planInitialization({
            cwd,
            vaultPath: vault,
            projectSlug: "capture-extension",
          });
          const secondInitialization = yield* applyInitialization(cwd, config);
          const status = yield* loadStatus(cwd, branch);
          const projectDocument = yield* fs.readFileString(
            join(vault, "projects", "capture-extension.md"),
          );
          const memoryDocument = yield* fs.readFileString(join(vault, "MEMORY.md"));

          expect(creationPlan.projectMissing).toBe(true);
          expect(firstInitialization.projectCreated).toBe(true);
          expect(firstInitialization.routeAdded).toBe(true);
          expect(firstInitialization.gitExcludeUpdated).toBe(true);
          expect(reusePlan.projectMissing).toBe(false);
          expect(secondInitialization.projectCreated).toBe(false);
          expect(secondInitialization.routeAdded).toBe(false);
          expect(secondInitialization.gitExcludeUpdated).toBe(false);
          expect(projectDocument).toContain("# capture-extension");
          expect(projectDocument).toContain("## Resume context");
          expect(projectDocument).toContain("## Project timeline");
          expect(projectDocument).toContain("## Decision log");
          expect(projectDocument).toContain(
            "Run agentic-memory capture after meaningful project work.",
          );
          expect(memoryDocument).toContain("- [[projects/capture-extension]] — capture-extension.");
          expect(yield* fs.readFileString(join(cwd, ".git", "info", "exclude"))).toContain(
            ".agentic-memory-link/",
          );
          expect(status.config._tag).toBe("valid");
          expect(status.latestObservationStatus).toBe("captured");
          expect(status.latestObservationSummary).toBe("Record capture setup");
          expect(status.latestScheduleStatus).toBe("succeeded");
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(() => {}),
      );
  });
});
