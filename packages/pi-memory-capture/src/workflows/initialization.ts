import { ensureGitExcludeEntry } from "@urban/agentic-memory-core/link/GitExclude";
import { LinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import {
  ensureMemoryRoute,
  ensureProjectFile,
  projectFilePath,
} from "@urban/agentic-memory-core/vault/ProjectRoute";
import { validateVaultForLink } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Clock, DateTime, Effect, FileSystem } from "effect";
import { CaptureConfig, CaptureConfigState } from "../services/CaptureConfig.ts";

export type InitializationInputs = {
  readonly cwd: string;
  readonly vaultPath: string;
  readonly projectSlug: string;
};

export type InitializationOverwriteConflict = {
  readonly current: LinkConfig;
  readonly next: LinkConfig;
};

export type InitializationPlan = {
  readonly config: LinkConfig;
  readonly overwriteConflict: InitializationOverwriteConflict | undefined;
  readonly projectMissing: boolean;
};

export type InitializationResult = {
  readonly config: LinkConfig;
  readonly projectCreated: boolean;
  readonly routeAdded: boolean;
  readonly gitExcludeUpdated: boolean;
};

const nowValues = Clock.clockWith((clock) =>
  Effect.sync(() => ({
    isoDate: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe())),
  })),
);

export const planInitialization = Effect.fn("MemoryCapture.planInitialization")(function* (
  input: InitializationInputs,
) {
  const captureConfig = yield* CaptureConfig;
  const fs = yield* FileSystem.FileSystem;
  const existingConfig = yield* captureConfig.load(input.cwd);
  const validated = LinkConfig.make({
    version: 1,
    vaultPath: input.vaultPath.trim(),
    projectSlug: input.projectSlug.trim(),
  });
  yield* validateVaultForLink(validated.vaultPath);
  const overwriteConflict =
    CaptureConfigState.guards.valid(existingConfig) &&
    (existingConfig.config.vaultPath !== validated.vaultPath ||
      existingConfig.config.projectSlug !== validated.projectSlug)
      ? {
          current: existingConfig.config,
          next: validated,
        }
      : undefined;
  const filepath = yield* projectFilePath(validated.vaultPath, validated.projectSlug);
  const projectExists = yield* fs.exists(filepath);

  return {
    config: validated,
    overwriteConflict,
    projectMissing: !projectExists,
  } satisfies InitializationPlan;
});

export const applyInitialization = Effect.fn("MemoryCapture.applyInitialization")(function* (
  cwd: string,
  configValue: LinkConfig,
) {
  const captureConfig = yield* CaptureConfig;
  const time = yield* nowValues;
  const projectCreated = yield* ensureProjectFile({
    vaultPath: configValue.vaultPath,
    projectSlug: configValue.projectSlug,
    date: time.isoDate,
  });
  const routeAdded = yield* ensureMemoryRoute({
    vaultPath: configValue.vaultPath,
    projectSlug: configValue.projectSlug,
    date: time.isoDate,
  });
  yield* captureConfig.ensureLocalFiles(cwd, configValue);
  const gitExclude = yield* ensureGitExcludeEntry(cwd);

  return {
    config: configValue,
    projectCreated,
    routeAdded,
    gitExcludeUpdated: gitExclude.updated,
  } satisfies InitializationResult;
});
