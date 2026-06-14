import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, ManagedRuntime } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeProjectConfigJson, type ResolvedProjectConfig } from "../../src/schema.ts";
import { CaptureConfig } from "../../src/services/CaptureConfig.ts";
import { Git } from "../../src/services/Git.ts";
import { Markers } from "../../src/services/Markers.ts";
import { VaultProjects } from "../../src/services/VaultProjects.ts";
import { applyInitialization } from "../../src/workflows/initialization.ts";
import { loadStatus } from "../../src/workflows/status.ts";
import {
  createTempDirectory,
  makeCustomMarkerEntry,
  removeTempDirectory,
  writeFile,
} from "../helpers.ts";

const captureConfigLayer = CaptureConfig.layer.pipe(Layer.provideMerge(VaultProjects.layer));
const runtimeLayer = Layer.mergeAll(
  VaultProjects.layer,
  captureConfigLayer,
  Layer.succeed(
    Git,
    Git.of({
      resolveGitDir: () => Effect.void.pipe(Effect.as(undefined)),
      ensureInfoExcludeEntry: () => Effect.succeed(false),
    }),
  ),
  Markers.layer,
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

describe("initialization status flow", () => {
  it("writes link config and status reports latest branch-local markers", () => {
    const root = createTempDirectory("pi-memory-init-status-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".agentic-memory-link");
    const vault = join(root, "vault");
    const config: ResolvedProjectConfig = {
      version: 1,
      vaultPath: vault,
      projectSlug: "capture-extension",
    };

    writeFile(join(vault, ".agentic-memory", "LLM-outside-vault.md"), "# contract");
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
    writeFile(
      join(localDirectory, "config.json"),
      `${Effect.runSync(encodeProjectConfigJson(config))}\n`,
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
          yield* applyInitialization(cwd, config);
          const status = yield* loadStatus(cwd, branch);

          expect(status.config._tag).toBe("valid");
          expect(status.latestObservationStatus).toBe("captured");
          expect(status.latestObservationSummary).toBe("Record capture setup");
          expect(status.latestScheduleStatus).toBe("succeeded");
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });
});
