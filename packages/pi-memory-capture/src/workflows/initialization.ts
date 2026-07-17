import { ensureGitExcludeEntry } from "@urban/agentic-memory-core/link/GitExclude";
import { Clock, DateTime, Effect } from "effect";
import { LoadConfigResult } from "../schema.ts";
import { CaptureConfig } from "../services/CaptureConfig.ts";
import { VaultProjects } from "../services/VaultProjects.ts";

type ResolvedProjectConfig = import("../schema.ts").ResolvedProjectConfig;

export interface InitializationInputs {
  readonly cwd: string;
  readonly vaultPath: string;
  readonly projectSlug: string;
}

export interface InitializationOverwriteConflict {
  readonly current: ResolvedProjectConfig;
  readonly next: ResolvedProjectConfig;
}

export interface InitializationPlan {
  readonly config: ResolvedProjectConfig;
  readonly overwriteConflict: InitializationOverwriteConflict | undefined;
  readonly projectMissing: boolean;
}

export interface InitializationResult {
  readonly config: ResolvedProjectConfig;
  readonly projectCreated: boolean;
  readonly routeAdded: boolean;
  readonly gitExcludeUpdated: boolean;
}

const nowValues = Clock.clockWith((clock) =>
  Effect.sync(() => ({
    isoDate: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe())),
  })),
);

export const planInitialization = Effect.fn("MemoryCapture.planInitialization")(function* (
  input: InitializationInputs,
) {
  const captureConfig = yield* CaptureConfig;
  const vaultProjects = yield* VaultProjects;
  const existingConfig = yield* captureConfig.load(input.cwd);
  const validated = yield* vaultProjects.validateTarget({
    version: 1,
    vaultPath: input.vaultPath.trim(),
    projectSlug: input.projectSlug.trim(),
  });
  const overwriteConflict =
    LoadConfigResult.guards.valid(existingConfig) &&
    (existingConfig.config.vaultPath !== validated.vaultPath ||
      existingConfig.config.projectSlug !== validated.projectSlug)
      ? {
          current: existingConfig.config,
          next: validated,
        }
      : undefined;
  const projectExists = yield* vaultProjects.projectExists(validated);

  return {
    config: validated,
    overwriteConflict,
    projectMissing: !projectExists,
  } satisfies InitializationPlan;
});

export const applyInitialization = Effect.fn("MemoryCapture.applyInitialization")(function* (
  cwd: string,
  configValue: ResolvedProjectConfig,
) {
  const captureConfig = yield* CaptureConfig;
  const vaultProjects = yield* VaultProjects;
  const time = yield* nowValues;
  const projectCreated = yield* vaultProjects.ensureProjectFile(configValue, time.isoDate);
  const routeAdded = yield* vaultProjects.ensureMemoryRoute(configValue, time.isoDate);
  yield* captureConfig.ensureLocalFiles(cwd, configValue);
  const gitExclude = yield* ensureGitExcludeEntry(cwd);

  return {
    config: configValue,
    projectCreated,
    routeAdded,
    gitExcludeUpdated: gitExclude.updated,
  } satisfies InitializationResult;
});
