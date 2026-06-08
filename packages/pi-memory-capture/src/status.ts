import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { loadStatus } from "./runtime.ts";

export const runStatusCommand = Effect.fn("MemoryCapture.runStatusCommand")(function* (
  ctx: ExtensionCommandContext,
) {
  const status = yield* loadStatus(ctx.cwd, ctx.sessionManager);
  const lines = [
    `config: ${status.config._tag}`,
    ...(status.config._tag === "valid"
      ? [`vault: ${status.config.config.vaultPath}`, `project: ${status.config.config.projectLink}`]
      : status.config._tag === "invalid"
        ? [status.config.message]
        : ["memory capture has not been initialized"]),
    `automatic capture: ${status.automaticCaptureEnabled ? "enabled" : "disabled"}`,
    `latest success: ${status.latestAdvancingMarkerSummary ?? "none"}`,
    `latest failure: ${status.latestFailureSummary ?? "none"}`,
    `pending candidates: ${status.pendingCandidateSummaries.length}`,
  ];
  if (status.pendingCandidateSummaries.length > 0) {
    lines.push(...status.pendingCandidateSummaries.map((summary) => `- ${summary}`));
  }
  if (status.warnings.length > 0) {
    lines.push(`warnings: ${status.warnings.join(" | ")}`);
  }

  yield* Effect.sync(() => {
    if (ctx.hasUI) {
      ctx.ui.notify(lines.join("\n"), status.automaticCaptureEnabled ? "info" : "warning");
    }
  });
});
