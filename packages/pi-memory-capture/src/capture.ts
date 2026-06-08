import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { notificationLevelForCapture, runCapturePass, timeoutForCheckpoint } from "./runtime.ts";

import { CUSTOM_ENTRY_TYPE } from "./constants.ts";

const formatCaptureNotification = (execution: {
  readonly status: string;
  readonly summary: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}): string => {
  const lines = [`${execution.status}: ${execution.summary}`];

  if (execution.changedFiles.length > 0) {
    lines.push(`files: ${execution.changedFiles.join(", ")}`);
  }
  if (execution.warnings.length > 0) {
    lines.push(`warnings: ${execution.warnings.join(" | ")}`);
  }

  return lines.join("\n");
};

export const runCapture = Effect.fn("MemoryCapture.runCapture")(function* (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  checkpoint:
    | "manual"
    | "session_before_compact"
    | "session_shutdown"
    | "session_before_tree"
    | "session_before_fork"
    | "session_before_clone",
  mode: "manual" | "automatic",
) {
  const execution = yield* runCapturePass({
    cwd: ctx.cwd,
    sessionManager: ctx.sessionManager,
    checkpoint,
    timeoutMillis: timeoutForCheckpoint(checkpoint),
    mode,
  });

  yield* Effect.sync(() => {
    if (execution.marker !== undefined) {
      pi.appendEntry(CUSTOM_ENTRY_TYPE, execution.marker);
    }

    if (
      ctx.hasUI &&
      execution.status !== "ignored" &&
      !(mode === "automatic" && execution.status === "no_new_entries")
    ) {
      ctx.ui.notify(
        formatCaptureNotification(execution),
        notificationLevelForCapture(execution, mode),
      );
    }
  });
});
