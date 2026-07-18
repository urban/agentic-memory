import { Effect } from "effect";
import { CUSTOM_ENTRY_TYPE } from "./constants.ts";
import { runCapturePass, timeoutForTrigger } from "./workflows/capture.ts";

type ExtensionAPI = import("@earendil-works/pi-coding-agent").ExtensionAPI;
type ExtensionContext = import("@earendil-works/pi-coding-agent").ExtensionContext;
type TriggerKind = import("./markers/CaptureMarker.ts").TriggerKind;
type CaptureExecution = import("./workflows/capture.ts").CaptureExecution;

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

const notificationLevelForCapture = (execution: CaptureExecution): "info" | "warning" =>
  execution.status === "failed" ? "warning" : "info";

const shouldNotify = (execution: CaptureExecution): boolean =>
  execution.status === "captured" || execution.status === "failed";

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

export const runCapture = Effect.fn("MemoryCapture.runCapture")(function* (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  triggerKind: TriggerKind,
  force: boolean,
  abortSignal?: AbortSignal,
) {
  if (isAborted(abortSignal)) {
    return;
  }

  const execution = yield* runCapturePass({
    cwd: ctx.cwd,
    branch: ctx.sessionManager.getBranch(),
    triggerKind,
    timeoutMillis: timeoutForTrigger(triggerKind),
    force,
  });

  if (isAborted(abortSignal)) {
    return;
  }

  const markerAttributes = {
    "capture.run_id": execution.captureRunId,
    ...(execution.attemptId === undefined ? {} : { "capture.attempt_id": execution.attemptId }),
    "capture.trigger_kind": triggerKind,
    "capture.status": execution.status,
    "capture.marker_count": execution.markers.length,
  };

  yield* Effect.sync(() => {
    if (isAborted(abortSignal)) {
      return;
    }

    for (const marker of execution.markers) {
      if (isAborted(abortSignal)) {
        return;
      }

      pi.appendEntry(CUSTOM_ENTRY_TYPE, marker);
    }

    if (!isAborted(abortSignal) && ctx.hasUI && shouldNotify(execution)) {
      ctx.ui.notify(formatCaptureNotification(execution), notificationLevelForCapture(execution));
    }
  }).pipe(Effect.withSpan("capture.write_markers", { attributes: markerAttributes }));
});
