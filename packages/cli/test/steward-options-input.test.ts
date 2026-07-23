import { assert, describe, it } from "@effect/vitest";
import {
  decodeStewardModel,
  decodeStewardProvider,
  decodeStewardThinkingLevel,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import { Effect, Option } from "effect";
import { stewardRunOptionsFromInput } from "../src/commands/steward-options-input.ts";

type StewardModel = import("@urban/agentic-memory-core/steward/StewardExecution").StewardModel;
type StewardProvider =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardProvider;
type StewardThinkingLevel =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardThinkingLevel;

const noStewardOptions = {
  provider: Option.none<StewardProvider>(),
  model: Option.none<StewardModel>(),
  thinking: Option.none<StewardThinkingLevel>(),
  timeoutMillis: Option.none<number>(),
};

describe("steward options CLI input", () => {
  it("omits absent steward options", () => {
    assert.deepStrictEqual(stewardRunOptionsFromInput(noStewardOptions), {});
  });

  it.effect("assembles decoded steward option overrides", () =>
    Effect.gen(function* () {
      const options = stewardRunOptionsFromInput({
        provider: Option.some(yield* decodeStewardProvider("anthropic")),
        model: Option.some(yield* decodeStewardModel("claude-sonnet-4")),
        thinking: Option.some(yield* decodeStewardThinkingLevel("high")),
        timeoutMillis: Option.some(30_000),
      });

      assert.strictEqual(options.provider, "anthropic");
      assert.strictEqual(options.model, "claude-sonnet-4");
      assert.strictEqual(options.thinking, "high");
      assert.strictEqual(options.timeoutMillis, 30_000);
    }),
  );
});
