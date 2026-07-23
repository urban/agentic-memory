import {
  decodeStewardModel,
  decodeStewardProvider,
  decodeStewardThinkingLevel,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import { Effect, Option } from "effect";
import { CliError, Flag } from "effect/unstable/cli";

type StewardModel = import("@urban/agentic-memory-core/steward/StewardExecution").StewardModel;
type StewardProvider =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardProvider;
type StewardRunOptions =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardRunOptions;
type StewardThinkingLevel =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardThinkingLevel;

const invalidStewardOverride = (
  option: "provider" | "model" | "thinking",
  value: string,
  expected: string,
): CliError.InvalidValue =>
  new CliError.InvalidValue({
    option,
    value,
    expected,
    kind: "flag",
  });

export const providerFlag = Flag.string("provider").pipe(
  Flag.withDescription("Memory Steward provider override"),
  Flag.mapEffect((value) =>
    decodeStewardProvider(value).pipe(
      Effect.mapError(() =>
        invalidStewardOverride("provider", value, "selector containing non-whitespace content"),
      ),
    ),
  ),
  Flag.optional,
);

export const modelFlag = Flag.string("model").pipe(
  Flag.withDescription("Memory Steward model override"),
  Flag.mapEffect((value) =>
    decodeStewardModel(value).pipe(
      Effect.mapError(() =>
        invalidStewardOverride("model", value, "selector containing non-whitespace content"),
      ),
    ),
  ),
  Flag.optional,
);

export const thinkingFlag = Flag.string("thinking").pipe(
  Flag.withDescription("Memory Steward thinking level override"),
  Flag.mapEffect((value) =>
    decodeStewardThinkingLevel(value).pipe(
      Effect.mapError(() =>
        invalidStewardOverride("thinking", value, "off, minimal, low, medium, high, xhigh, or max"),
      ),
    ),
  ),
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
  readonly provider: Option.Option<StewardProvider>;
  readonly model: Option.Option<StewardModel>;
  readonly thinking: Option.Option<StewardThinkingLevel>;
  readonly timeoutMillis: Option.Option<number>;
}): StewardRunOptions => ({
  ...(Option.isSome(input.provider) ? { provider: input.provider.value } : {}),
  ...(Option.isSome(input.model) ? { model: input.model.value } : {}),
  ...(Option.isSome(input.thinking) ? { thinking: input.thinking.value } : {}),
  ...(Option.isSome(input.timeoutMillis) ? { timeoutMillis: input.timeoutMillis.value } : {}),
});
