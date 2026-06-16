import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { CUSTOM_ENTRY_TYPE } from "./constants.ts";
import type { NotificationLevel, TriggerKind } from "./schema.ts";
import { runCapturePass, timeoutForTrigger, type CaptureExecution } from "./workflows/capture.ts";

const formatCaptureNotification = (execution: CaptureExecution): string => {
  const lines = [`${execution.status}: ${execution.summary}`];

  if (execution.changedFiles.length > 0) {
    lines.push(`files: ${execution.changedFiles.join(", ")}`);
  }
  if (execution.warnings.length > 0) {
    lines.push(`warnings: ${execution.warnings.join(" | ")}`);
  }

  return lines.join("\n");
};

const notificationLevelForCapture = (execution: CaptureExecution): NotificationLevel =>
  execution.status === "failed" ? "warning" : "info";

const shouldNotify = (execution: CaptureExecution): boolean =>
  execution.status === "captured" || execution.status === "failed";

export const runCapture = Effect.fn("MemoryCapture.runCapture")(function* (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  triggerKind: TriggerKind,
  force: boolean,
) {
  const execution = yield* runCapturePass({
    cwd: ctx.cwd,
    branch: ctx.sessionManager.getBranch(),
    triggerKind,
    timeoutMillis: timeoutForTrigger(triggerKind),
    force,
  });

  const markerAttributes = {
    "capture.run_id": execution.captureRunId,
    ...(execution.attemptId === undefined ? {} : { "capture.attempt_id": execution.attemptId }),
    "capture.trigger_kind": triggerKind,
    "capture.status": execution.status,
    "capture.marker_count": execution.markers.length,
  };

  yield* Effect.sync(() => {
    for (const marker of execution.markers) {
      pi.appendEntry(CUSTOM_ENTRY_TYPE, marker);
    }

    if (ctx.hasUI && shouldNotify(execution)) {
      ctx.ui.notify(formatCaptureNotification(execution), notificationLevelForCapture(execution));
    }
  }).pipe(Effect.withSpan("capture.write_markers", { attributes: markerAttributes }));
});
