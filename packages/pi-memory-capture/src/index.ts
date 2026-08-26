import { runCapture } from "./capture.ts";
import { runInitCommand } from "./initialization.ts";
import { makeMemoryCaptureRuntime } from "./runtime.ts";
import { runStatusCommand } from "./status.ts";

type ExtensionAPI = import("@earendil-works/pi-coding-agent").ExtensionAPI;
type ExtensionContext = import("@earendil-works/pi-coding-agent").ExtensionContext;

const notifyError = (ctx: ExtensionContext, message: string) => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
  }
};

const notifyUnexpectedError = (ctx: ExtensionContext, fallback: string) => (error: unknown) => {
  notifyError(ctx, error instanceof Error ? error.message : fallback);
};

const withAbortSafeEntries = (pi: ExtensionAPI, signal: AbortSignal): ExtensionAPI => ({
  ...pi,
  appendEntry: (customType, data) => {
    if (!signal.aborted) {
      pi.appendEntry(customType, data);
    }
  },
});

export default function memoryCapture(pi: ExtensionAPI) {
  const runtime = makeMemoryCaptureRuntime(pi);

  pi.registerCommand("memory-capture-init", {
    description: "Initialize Agentic Memory capture for this project",
    handler: (args, ctx) =>
      runtime
        .runPromise(runInitCommand(args, ctx))
        .catch(notifyUnexpectedError(ctx, "Initialization failed unexpectedly.")),
  });

  pi.registerCommand("memory-capture-status", {
    description: "Show Agentic Memory capture status for this project",
    handler: (_args, ctx) =>
      runtime
        .runPromise(runStatusCommand(ctx))
        .catch(notifyUnexpectedError(ctx, "Failed to load capture status.")),
  });

  pi.on("agent_end", (_event, ctx) =>
    runtime
      .runPromise(runCapture(pi, ctx, "agent_end", false))
      .catch(notifyUnexpectedError(ctx, "Automatic capture failed after agent turn.")),
  );

  pi.on("session_before_tree", (event, ctx) =>
    runtime
      .runPromise(
        runCapture(
          withAbortSafeEntries(pi, event.signal),
          ctx,
          "session_before_tree",
          true,
          event.signal,
        ),
        {
          signal: event.signal,
        },
      )
      .catch((error: unknown) => {
        if (event.signal.aborted) {
          return;
        }

        notifyUnexpectedError(ctx, "Automatic capture failed before tree navigation.")(error);
      }),
  );

  pi.on("session_shutdown", (_event, ctx) =>
    runtime
      .runPromise(runCapture(pi, ctx, "session_shutdown", true))
      .catch(notifyUnexpectedError(ctx, "Automatic capture failed during shutdown."))
      .finally(() => runtime.dispose()),
  );
}
