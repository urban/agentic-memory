import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  CapturePayloadJson,
  StewardResultEnvelopeJson,
  encodeCapturePayloadJson,
} from "../src/schema.ts";

describe("domain contracts", () => {
  it("validates capture payload and steward result json contracts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* Schema.decodeUnknownEffect(CapturePayloadJson)(
          yield* encodeCapturePayloadJson({
            version: 1,
            projectSlug: "capture-extension",
            messages: [
              {
                role: "user",
                text: "hello",
              },
            ],
          }),
        );
        const result = yield* Schema.decodeUnknownEffect(StewardResultEnvelopeJson)(
          yield* Schema.encodeUnknownEffect(StewardResultEnvelopeJson)({
            status: "captured",
            summary: "Record project history",
            filesChanged: ["projects/capture-extension.md"],
            warnings: [],
            decisionReport: {
              decisionSummary: "Project memory should be updated.",
              durability: "durable",
              selectedDestinations: [
                {
                  target: "projects/capture-extension.md",
                  memoryLayer: "project",
                  reason: "The observation is project-specific resume context.",
                },
              ],
              skippedDestinations: [],
              durableSignals: ["Future sessions need this project context."],
              duplicateSignals: [],
              privacyNotes: ["No raw transcript text was stored."],
            },
          }),
        );

        expect(payload.projectSlug).toBe("capture-extension");
        expect(result.status).toBe("captured");
      }),
    ));

  it("rejects captured steward results without a summary", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Schema.decodeUnknownEffect(StewardResultEnvelopeJson)(
          '{"status":"captured","decisionReport":{"decisionSummary":"Project memory should be updated.","durability":"durable","selectedDestinations":[{"target":"projects/capture-extension.md","memoryLayer":"project","reason":"The observation is project-specific resume context."}],"skippedDestinations":[],"durableSignals":["Future sessions need this project context."],"duplicateSignals":[],"privacyNotes":["No raw transcript text was stored."]}}',
        ).pipe(Effect.exit);
        const missingDecisionReport = yield* Schema.decodeUnknownEffect(StewardResultEnvelopeJson)(
          '{"status":"captured","summary":"Record project history"}',
        ).pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
        expect(missingDecisionReport._tag).toBe("Failure");
      }),
    ));
});
