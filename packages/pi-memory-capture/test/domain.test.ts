import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  CapturePayloadJson,
  StewardResultEnvelopeJson,
  encodeCapturePayloadJson,
} from "../src/schema.ts";
import { applyProjectTemplate, ensureProjectRouteInMemory } from "../src/project.ts";
import { buildCapturePrompt, sanitizeVisibleText, truncateMessageText } from "../src/text.ts";

describe("domain helpers", () => {
  it("redacts secrets and normalizes visible text", () => {
    const sanitized = sanitizeVisibleText(`
Bearer sk-super-secret-token
OPENAI_API_KEY=abc123



hello
`);

    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(sanitized).not.toContain("abc123");
    expect(sanitized.endsWith("hello")).toBe(true);
  });

  it("redacts GitHub fine-grained personal access tokens", () => {
    const token = "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ11";
    const sanitized = sanitizeVisibleText(`token=${token}`);

    expect(sanitized).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized).not.toContain(token);
  });

  it("truncates oversized messages with the capture suffix", () => {
    const truncated = truncateMessageText("x".repeat(7_000));

    expect(truncated.truncated).toBe(true);
    expect(truncated.text.length).toBeLessThanOrEqual(6_000);
    expect(truncated.text).toContain("[message truncated to 6000 chars]");
  });

  it("adds a projects route and updates frontmatter dates", () => {
    const updated = ensureProjectRouteInMemory(
      `---
updated: 2026-01-01
---

# Memory

## Current

- Work in progress.
`,
      "[[projects/capture-extension]]",
      "capture-extension",
      "2026-06-05",
    );

    expect(updated).toContain("updated: 2026-06-05");
    expect(updated).toContain("## Projects");
    expect(updated).toContain("- [[projects/capture-extension]] — capture-extension.");
  });

  it("renders project templates from fenced markdown when required sections exist", () => {
    const rendered = applyProjectTemplate(
      `# Template

\`\`\`md
---
type: project
project_status: candidate
summary: "One-line project summary."
---

# Project Name

## Resume context

None.

## Project timeline

- YYYY-MM-DD: Started.

## Decision log

None.
\`\`\`
`,
      {
        projectLabel: "Capture Extension",
        date: "2026-06-05",
      },
    );

    expect(Option.isSome(rendered)).toBe(true);
    if (Option.isSome(rendered)) {
      expect(rendered.value).toContain("# Capture Extension");
      expect(rendered.value).toContain("project_status: active");
      expect(rendered.value).toContain("2026-06-05");
    }
  });

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
          '{"status":"captured"}',
        ).pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    ));

  it("builds a capture prompt that references the steward instruction", () => {
    const prompt = buildCapturePrompt('{"version":1}', ["Payload reached the cap."]);

    expect(prompt).toContain("instructions/session-capture.md");
    expect(prompt).toContain("Payload warnings:");
    expect(prompt).toContain('{"version":1}');
  });
});
