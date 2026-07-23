import { assert, describe, it } from "@effect/vitest";
import {
  decodeStewardModel,
  decodeStewardProvider,
  decodeStewardDuration,
  decodeStewardThinkingLevel,
  encodeStewardDurationSync,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import { Effect, Option } from "effect";
import { stewardRunOptionsFromInput } from "../src/commands/steward-options-input.ts";

type StewardModel = import("@urban/agentic-memory-core/steward/StewardExecution").StewardModel;
type StewardProvider =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardProvider;
type StewardThinkingLevel =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardThinkingLevel;
type StewardDuration =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardDuration;

const noStewardOptions = {
  provider: Option.none<StewardProvider>(),
  model: Option.none<StewardModel>(),
  thinking: Option.none<StewardThinkingLevel>(),
  timeout: Option.none<StewardDuration>(),
};

describe("steward options CLI input", () => {
  it("omits absent steward options", () => {
    assert.deepStrictEqual(stewardRunOptionsFromInput(noStewardOptions), {});
  });

  it.effect("assembles decoded steward option overrides", () =>
    Effect.gen(function* () {
      const timeout = yield* decodeStewardDuration("0.5ms");
      const options = stewardRunOptionsFromInput({
        provider: Option.some(yield* decodeStewardProvider("anthropic")),
        model: Option.some(yield* decodeStewardModel("claude-sonnet-4")),
        thinking: Option.some(yield* decodeStewardThinkingLevel("high")),
        timeout: Option.some(timeout),
      });

      assert.strictEqual(options.provider, "anthropic");
      assert.strictEqual(options.model, "claude-sonnet-4");
      assert.strictEqual(options.thinking, "high");
      assert.strictEqual(options.timeout?.toString(), "500000 nanos");
      const encodedTimeout = encodeStewardDurationSync(timeout);
      assert.strictEqual(encodedTimeout, "500000 nanos");
      assert.strictEqual((yield* decodeStewardDuration(encodedTimeout)).toString(), "500000 nanos");
    }),
  );
});
