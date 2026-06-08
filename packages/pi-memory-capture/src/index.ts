import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeForkEvent,
} from "@earendil-works/pi-coding-agent";
import { runInitCommand } from "./initialization.ts";
import { checkpointFromForkPosition, makeMemoryCaptureRuntime } from "./runtime.ts";
import { runStatusCommand } from "./status.ts";
import { runCapture } from "./capture.ts";

const notifyError = (ctx: ExtensionContext, message: string) => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
  }
};

const notifyUnexpectedError = (ctx: ExtensionContext, fallback: string) => (error: unknown) => {
  notifyError(ctx, error instanceof Error ? error.message : fallback);
};

export default function memoryCapture(pi: ExtensionAPI) {
  const runtime = makeMemoryCaptureRuntime(pi);

  // commands
  pi.registerCommand("memory-capture-init", {
    description: "Initialize Agentic Memory capture for this project",
    handler: (args, ctx) =>
      runtime
        .runPromise(runInitCommand(args, ctx))
        .catch((error: unknown) =>
          notifyError(
            ctx,
            error instanceof Error ? error.message : "Initialization filed unexpectedly.",
          ),
        ),
  });

  pi.registerCommand("memory-capture", {
    description: "Run a manual Agentic Memory capture pass",
    handler: (_args, ctx) =>
      runtime
        .runPromise(runCapture(pi, ctx, "manual", "manual"))
        .catch(notifyUnexpectedError(ctx, "Manual capture failed unexpectedly.")),
  });

  pi.registerCommand("memory-capture-status", {
    description: "Show Agentic Memory capture status for this project",
    handler: (_args, ctx) =>
      runtime
        .runPromise(runStatusCommand(ctx))
        .catch(notifyUnexpectedError(ctx, "Failed to load capture status.")),
  });

  // automatic capture handlers
  pi.on("session_before_compact", (_event, ctx) =>
    runtime
      .runPromise(runCapture(pi, ctx, "session_before_compact", "automatic"))
      .catch(notifyUnexpectedError(ctx, "Automatic capture failed before compaction.")),
  );

  pi.on("session_before_tree", (_event, ctx) =>
    runtime
      .runPromise(runCapture(pi, ctx, "session_before_tree", "automatic"))
      .catch(notifyUnexpectedError(ctx, "Automatic capture failed before tree navigation.")),
  );

  pi.on("session_before_fork", (event: SessionBeforeForkEvent, ctx) =>
    runtime
      .runPromise(runCapture(pi, ctx, checkpointFromForkPosition(event.position), "automatic"))
      .catch(notifyUnexpectedError(ctx, "Automatic capture failed before fork/clone.")),
  );

  pi.on("session_shutdown", (_event, ctx) =>
    runtime
      .runPromise(runCapture(pi, ctx, "session_shutdown", "automatic"))
      .catch(notifyUnexpectedError(ctx, "Automatic capture failed during shutdown."))
      .finally(() => runtime.dispose()),
  );
}
