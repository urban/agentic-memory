import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { loadStatus } from "./workflows/status.ts";

export const runStatusCommand = Effect.fn("MemoryCapture.runStatusCommand")(function* (
  ctx: ExtensionCommandContext,
) {
  const status = yield* loadStatus(ctx.cwd, ctx.sessionManager.getBranch());
  const lines = [
    `config: ${status.config._tag}`,
    ...(status.config._tag === "valid"
      ? [`vault: ${status.config.config.vaultPath}`, `project: ${status.config.config.projectLink}`]
      : status.config._tag === "invalid"
        ? [status.config.message]
        : ["memory capture has not been initialized"]),
    `automatic capture: ${status.automaticCaptureEnabled ? "enabled" : "disabled"}`,
    `latest observation: ${status.latestObservationStatus ?? "none"}${
      status.latestObservationSummary === undefined ? "" : ` — ${status.latestObservationSummary}`
    }`,
    `latest schedule: ${status.latestScheduleStatus ?? "none"}${
      status.latestScheduleSummary === undefined ? "" : ` — ${status.latestScheduleSummary}`
    }`,
  ];
  if (status.warnings.length > 0) {
    lines.push(`warnings: ${status.warnings.join(" | ")}`);
  }

  yield* Effect.sync(() => {
    if (ctx.hasUI) {
      ctx.ui.notify(lines.join("\n"), status.automaticCaptureEnabled ? "info" : "warning");
    }
  });
});
