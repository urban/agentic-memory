import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Clock, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { formatIsoDateFromMillis, formatIsoFromMillis } from "./project.ts";
import { emptyScratchpad } from "./scratchpad.ts";
import { encodeScratchpadJson, type ResolvedProjectConfig } from "./schema.ts";
import { Config } from "./services/Config.ts";

export interface InitializationResult {
  readonly config: ResolvedProjectConfig;
  readonly projectCreated: boolean;
  readonly routeAdded: boolean;
  readonly gitExcludeUpdated: boolean;
}

const nowValues = Clock.clockWith((clock) =>
  Effect.sync(() => {
    const millis = clock.currentTimeMillisUnsafe();
    return {
      isoTimestamp: formatIsoFromMillis(millis),
      isoDate: formatIsoDateFromMillis(millis),
    };
  }),
);

const parseInitCommandArgs = (args: string) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return {
      vaultPath: undefined,
      projectLink: undefined,
    };
  }

  const projectLinkMatch = trimmed.match(/(\[\[projects\/[a-z0-9][a-z0-9-]*\]\])\s*$/);
  if (projectLinkMatch?.[1] !== undefined) {
    const projectLink = projectLinkMatch[1];
    const vaultPath = trimmed.slice(0, projectLinkMatch.index).trim();
    return {
      vaultPath: vaultPath.length === 0 ? undefined : vaultPath,
      projectLink,
    };
  }

  return trimmed.startsWith("[[projects/")
    ? {
        vaultPath: undefined,
        projectLink: trimmed,
      }
    : {
        vaultPath: trimmed,
        projectLink: undefined,
      };
};

const promptForMissingValue = (ctx: ExtensionCommandContext, title: string, placeholder: string) =>
  ctx.hasUI ? Effect.promise(() => ctx.ui.input(title, placeholder)) : Effect.undefined;

const confirmDialog = (ctx: ExtensionCommandContext, title: string, description: string) =>
  ctx.hasUI ? Effect.promise(() => ctx.ui.confirm(title, description)) : Effect.succeed(false);

const resolveGitDir = Effect.fn("initialization.resolveGitDir")(function* (cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make("git", ["rev-parse", "--git-dir"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      const result = yield* Effect.all(
        {
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          exitCode: handle.exitCode,
        },
        { concurrency: 3 },
      );

      if (result.exitCode !== ChildProcessSpawner.ExitCode(0)) {
        return undefined;
      }

      const gitDir = result.stdout.trim();
      if (gitDir.length === 0) {
        return undefined;
      }

      return gitDir.startsWith("/") ? gitDir : `${cwd}/${gitDir}`;
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: 5_000,
      orElse: () => Effect.undefined,
    }),
    Effect.catch(() => Effect.undefined),
  );
});

const notifyError = (ctx: ExtensionContext, message: string) => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
  }
};

export const applyInitialization = Effect.fn("MemoryCapture.applyInitialization")(function* (
  cwd: string,
  configValue: ResolvedProjectConfig,
  gitDir: string | undefined,
) {
  const config = yield* Config;
  const time = yield* nowValues;
  const empty = emptyScratchpad(configValue.projectLink, time.isoTimestamp);
  const scratchpadContents = yield* encodeScratchpadJson(empty).pipe(Effect.orDie);
  const projectCreated = yield* config.ensureProjectFile(
    configValue.vaultPath,
    configValue.projectLink,
    time.isoDate,
  );
  const routeAdded = yield* config.ensureMemoryRoute(
    configValue.vaultPath,
    configValue.projectLink,
    time.isoDate,
  );
  yield* config.ensureLocalFiles(cwd, configValue, scratchpadContents);
  const gitExcludeUpdated =
    gitDir === undefined ? false : yield* config.ensureGitExcludeEntry(gitDir);

  return {
    config: configValue,
    projectCreated,
    routeAdded,
    gitExcludeUpdated,
  };
});

export const runInitCommand = Effect.fn("MemoryCapture.runInitCommand")(function* (
  args: string,
  ctx: ExtensionCommandContext,
) {
  const parsedArgs = parseInitCommandArgs(args);
  const config = yield* Config;
  const { vaultOverride } = yield* config.environmentOverrides;

  const vaultPath =
    parsedArgs.vaultPath ??
    vaultOverride ??
    (yield* promptForMissingValue(ctx, "Vault path", "/absolute/path/to/agentic-memory-vault"));
  if (vaultPath === undefined || vaultPath.trim().length === 0) {
    yield* Effect.sync(() => notifyError(ctx, "Vault path is required for /memory-capture-init."));
    return;
  }

  const projectLink =
    parsedArgs.projectLink ??
    (yield* promptForMissingValue(ctx, "Project link", "[[projects/example-project]]"));
  if (projectLink === undefined || projectLink.trim().length === 0) {
    yield* Effect.sync(() =>
      notifyError(ctx, "Project link is required for /memory-capture-init."),
    );
    return;
  }

  const existingConfig = yield* config.load(ctx.cwd);
  const validated = yield* config.validateInputs(vaultPath.trim(), projectLink.trim());

  if (
    existingConfig._tag === "valid" &&
    (existingConfig.config.vaultPath !== validated.vaultPath ||
      existingConfig.config.projectLink !== validated.projectLink)
  ) {
    if (!ctx.hasUI) {
      yield* Effect.sync(() =>
        notifyError(
          ctx,
          "Existing capture config differs. Run /memory-capture-init interactively to confirm overwrite.",
        ),
      );
      return;
    }

    const overwrite = yield* confirmDialog(
      ctx,
      "Overwrite existing config?",
      `Current: ${existingConfig.config.vaultPath} ${existingConfig.config.projectLink}\nNext: ${validated.vaultPath} ${validated.projectLink}`,
    );
    if (!overwrite) {
      yield* Effect.sync(() => ctx.ui.notify("Initialization cancelled.", "info"));
      return;
    }
  }

  const projectExists = yield* config.projectExists(validated.vaultPath, validated.projectLink);
  if (!projectExists) {
    if (!ctx.hasUI) {
      yield* Effect.sync(() =>
        notifyError(
          ctx,
          "The target project file does not exist in the vault. Run /memory-capture-init interactively to confirm creation.",
        ),
      );
      return;
    }

    const createProject = yield* confirmDialog(
      ctx,
      "Create project file?",
      `Create ${validated.projectLink} in ${validated.vaultPath}?`,
    );
    if (!createProject) {
      yield* Effect.sync(() => ctx.ui.notify("Initialization cancelled.", "info"));
      return;
    }
  }

  const gitDir = yield* resolveGitDir(ctx.cwd);
  const result = yield* applyInitialization(ctx.cwd, validated, gitDir);

  yield* Effect.sync(() => {
    if (ctx.hasUI) {
      const lines = [
        "Agentic Memory capture initialized.",
        `vault: ${result.config.vaultPath}`,
        `project: ${result.config.projectLink}`,
        result.projectCreated ? "project file: created" : "project file: reused",
        result.routeAdded ? "MEMORY.md route: added" : "MEMORY.md route: unchanged",
        result.gitExcludeUpdated ? ".git/info/exclude: updated" : ".git/info/exclude: unchanged",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    }
  });
});
