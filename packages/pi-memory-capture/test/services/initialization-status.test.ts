import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, ManagedRuntime } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyInitialization } from "../../src/initialization.ts";
import { loadStatus } from "../../src/runtime.ts";
import { encodeProjectConfigJson, encodeScratchpadJson } from "../../src/schema.ts";
import { Config } from "../../src/services/Config.ts";
import { Markers } from "../../src/services/Markers.ts";
import { ScratchpadStore } from "../../src/services/Scratchpad.ts";
import {
  createTempDirectory,
  makeSessionManager,
  removeTempDirectory,
  writeFile,
} from "../helpers.ts";

const runtimeLayer = Layer.mergeAll(Config.layer, Markers.layer, ScratchpadStore.layer).pipe(
  Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
);

describe("initialization status flow", () => {
  it("preserves pending scratchpad candidates when initialization reruns for the same project", () => {
    const root = createTempDirectory("pi-memory-init-status-");
    const cwd = join(root, "project");
    const localDirectory = join(cwd, ".pi", "agentic-memory-capture");
    const vault = join(root, "vault");
    const config = {
      version: 1 as const,
      vaultPath: vault,
      projectLink: "[[projects/capture-extension]]",
    };

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
    writeFile(
      join(localDirectory, "config.json"),
      `${Effect.runSync(encodeProjectConfigJson(config))}\n`,
    );
    writeFile(
      join(localDirectory, "scratchpad.json"),
      `${Effect.runSync(
        encodeScratchpadJson({
          version: 1,
          projectLink: config.projectLink,
          updatedAt: "2026-06-05T12:00:00.000Z",
          pendingCandidates: [
            {
              id: "candidate-1",
              kind: "project_decision",
              summary: "Preserve the project decision log.",
              evidenceCount: 2,
              firstSeenAt: "2026-06-05T12:00:00.000Z",
              lastSeenAt: "2026-06-05T12:00:00.000Z",
              confidence: "high",
              nextAction: "promote",
              reasonNotPromoted: "",
            },
          ],
        }),
      )}\n`,
    );
    const runtime = ManagedRuntime.make(runtimeLayer);

    return runtime
      .runPromise(
        Effect.gen(function* () {
          yield* applyInitialization(cwd, config, undefined);
          const status = yield* loadStatus(cwd, makeSessionManager([]));

          expect(status.pendingCandidateSummaries).toEqual(["Preserve the project decision log."]);
        }),
      )
      .finally(() =>
        Promise.all([runtime.dispose(), Promise.resolve(removeTempDirectory(root))]).then(
          () => undefined,
        ),
      );
  });
});
