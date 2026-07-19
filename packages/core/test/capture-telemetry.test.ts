import { assert, describe, it } from "@effect/vitest";
import {
  captureDecisionReportAttributes,
  captureStewardSessionAttributes,
} from "../src/observability/CaptureTelemetry.ts";

describe("capture telemetry attributes", () => {
  it("maps decision reports to the established capture attributes", () => {
    const attributes = captureDecisionReportAttributes({
      durability: "durable",
      selectedDestinations: [{ target: "projects/agentic-memory.md" }, { target: "USER.md" }],
      skippedDestinations: [{ memoryLayer: "records" }],
      decisionSummary: "Captured durable project context",
    });

    assert.deepStrictEqual(attributes, {
      "capture.decision.durability": "durable",
      "capture.decision.selected_count": 2,
      "capture.decision.skipped_count": 1,
      "capture.decision.summary": "Captured durable project context",
    });
  });

  it("maps steward sessions to the established capture attributes", () => {
    const attributes = captureStewardSessionAttributes({
      sessionId: "session-123",
      name: "Memory Steward",
      cwd: "/workspace/agentic-memory",
      startedAt: "2026-07-19T12:34:56.000Z",
    });

    assert.deepStrictEqual(attributes, {
      "capture.steward.session_id": "session-123",
      "capture.steward.session_name": "Memory Steward",
      "capture.steward.session_cwd": "/workspace/agentic-memory",
      "capture.steward.session_started_at": "2026-07-19T12:34:56.000Z",
    });
  });

  it("omits steward session attributes when the session is absent", () => {
    assert.deepStrictEqual(captureStewardSessionAttributes(undefined), {});
  });
});
