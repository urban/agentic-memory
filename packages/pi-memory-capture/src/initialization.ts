import { isProjectSlug } from "@urban/agentic-memory-core/link/ProjectSlug";
import { Effect } from "effect";
import { CaptureConfig } from "./services/CaptureConfig.ts";
import { applyInitialization, planInitialization } from "./workflows/initialization.ts";

type ExtensionCommandContext = import("@earendil-works/pi-coding-agent").ExtensionCommandContext;
type ExtensionContext = import("@earendil-works/pi-coding-agent").ExtensionContext;

const PROJECT_LINK_PATTERN = /^\[\[projects\/([a-z0-9][a-z0-9-]*)\]\]$/;

const projectSlugFromLink = (value: string): string | undefined =>
  value.match(PROJECT_LINK_PATTERN)?.[1];

const normalizeProjectSlugInput = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (isProjectSlug(trimmed)) {
    return trimmed;
  }

  return projectSlugFromLink(trimmed);
};

const parseInitCommandArgs = (args: string) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return {
      vaultPath: undefined,
      projectSlug: undefined,
    };
  }

  const parts = trimmed.split(/\s+/);
  const maybeSlug = normalizeProjectSlugInput(parts.at(-1));
  if (maybeSlug !== undefined && parts.length > 1) {
    return {
      vaultPath: parts.slice(0, -1).join(" "),
      projectSlug: maybeSlug,
    };
  }

  const projectSlug = normalizeProjectSlugInput(trimmed);

  return projectSlug !== undefined && !trimmed.startsWith("/")
    ? {
        vaultPath: undefined,
        projectSlug,
      }
    : {
        vaultPath: trimmed,
        projectSlug: undefined,
      };
};

const promptForMissingValue = (ctx: ExtensionCommandContext, title: string, placeholder: string) =>
  ctx.hasUI
    ? Effect.promise(() => ctx.ui.input(title, placeholder))
    : Effect.void.pipe(Effect.as(undefined));

const confirmDialog = (ctx: ExtensionCommandContext, title: string, description: string) =>
  ctx.hasUI ? Effect.promise(() => ctx.ui.confirm(title, description)) : Effect.succeed(false);

const notifyError = (ctx: ExtensionContext, message: string) => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
  }
};

export const runInitCommand = Effect.fn("MemoryCapture.runInitCommand")(function* (
  args: string,
  ctx: ExtensionCommandContext,
) {
  const cwd = ctx.cwd;
  const parsedArgs = parseInitCommandArgs(args);
  const config = yield* CaptureConfig;
  const { vaultOverride } = yield* config.environmentOverrides;

  const vaultPath =
    parsedArgs.vaultPath ??
    vaultOverride ??
    (yield* promptForMissingValue(ctx, "Vault path", "/absolute/path/to/agentic-memory-vault"));
  if (vaultPath === undefined || vaultPath.trim().length === 0) {
    yield* Effect.sync(() => notifyError(ctx, "Vault path is required for /memory-capture-init."));
    return;
  }

  const requestedProjectSlug = normalizeProjectSlugInput(
    parsedArgs.projectSlug ??
      (yield* promptForMissingValue(ctx, "Project link", "[[projects/example-project]]")),
  );
  if (requestedProjectSlug === undefined) {
    yield* Effect.sync(() =>
      notifyError(ctx, "Project link or slug is required for /memory-capture-init."),
    );
    return;
  }

  const plan = yield* planInitialization({
    cwd,
    vaultPath,
    projectSlug: requestedProjectSlug,
  });

  if (plan.overwriteConflict !== undefined) {
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
      `Current: ${plan.overwriteConflict.current.vaultPath} ${plan.overwriteConflict.current.projectSlug}\nNext: ${plan.overwriteConflict.next.vaultPath} ${plan.overwriteConflict.next.projectSlug}`,
    );
    if (!overwrite) {
      yield* Effect.sync(() => ctx.ui.notify("Initialization cancelled.", "info"));
      return;
    }
  }

  if (plan.projectMissing) {
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
      `Create project ${plan.config.projectSlug} in ${plan.config.vaultPath}?`,
    );
    if (!createProject) {
      yield* Effect.sync(() => ctx.ui.notify("Initialization cancelled.", "info"));
      return;
    }
  }

  const result = yield* applyInitialization(cwd, plan.config);

  yield* Effect.sync(() => {
    if (ctx.hasUI) {
      const lines = [
        "Agentic Memory capture initialized.",
        `vault: ${result.config.vaultPath}`,
        `project: ${result.config.projectSlug}`,
        result.projectCreated ? "project file: created" : "project file: reused",
        result.routeAdded ? "MEMORY.md route: added" : "MEMORY.md route: unchanged",
        result.gitExcludeUpdated ? ".git/info/exclude: updated" : ".git/info/exclude: unchanged",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    }
  });
});
