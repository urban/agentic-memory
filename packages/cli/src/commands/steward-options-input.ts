type StewardRunOptions =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardRunOptions;
import { Effect, Option } from "effect";
import { CliError, Flag } from "effect/unstable/cli";

export const providerFlag = Flag.string("provider").pipe(
  Flag.withDescription("Memory Steward provider override"),
  Flag.optional,
);

export const modelFlag = Flag.string("model").pipe(
  Flag.withDescription("Memory Steward model override"),
  Flag.optional,
);

export const thinkingFlag = Flag.string("thinking").pipe(
  Flag.withDescription("Memory Steward thinking level override"),
  Flag.optional,
);

export const timeoutMillisFlag = Flag.integer("timeout-ms").pipe(
  Flag.withDescription("Positive timeout in milliseconds for the Memory Steward run"),
  Flag.mapEffect((value) =>
    value > 0
      ? Effect.succeed(value)
      : Effect.fail(
          new CliError.InvalidValue({
            option: "timeout-ms",
            value: String(value),
            expected: "positive integer",
            kind: "flag",
          }),
        ),
  ),
  Flag.optional,
);

export const stewardRunOptionsFromInput = (input: {
  readonly provider: Option.Option<string>;
  readonly model: Option.Option<string>;
  readonly thinking: Option.Option<string>;
  readonly timeoutMillis: Option.Option<number>;
}): StewardRunOptions => ({
  ...(Option.isSome(input.provider) ? { provider: input.provider.value } : {}),
  ...(Option.isSome(input.model) ? { model: input.model.value } : {}),
  ...(Option.isSome(input.thinking) ? { thinking: input.thinking.value } : {}),
  ...(Option.isSome(input.timeoutMillis) ? { timeoutMillis: input.timeoutMillis.value } : {}),
});
