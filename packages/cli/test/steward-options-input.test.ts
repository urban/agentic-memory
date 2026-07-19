import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { stewardRunOptionsFromInput } from "../src/commands/steward-options-input.ts";

const noStewardOptions = {
  provider: Option.none<string>(),
  model: Option.none<string>(),
  thinking: Option.none<string>(),
  timeoutMillis: Option.none<number>(),
};

describe("steward options CLI input", () => {
  it("omits absent steward options", () => {
    assert.deepStrictEqual(stewardRunOptionsFromInput(noStewardOptions), {});
  });

  it("assembles steward option overrides", () => {
    assert.deepStrictEqual(
      stewardRunOptionsFromInput({
        provider: Option.some("anthropic"),
        model: Option.some("claude-sonnet-4"),
        thinking: Option.some("high"),
        timeoutMillis: Option.some(30_000),
      }),
      {
        provider: "anthropic",
        model: "claude-sonnet-4",
        thinking: "high",
        timeoutMillis: 30_000,
      },
    );
  });
});
