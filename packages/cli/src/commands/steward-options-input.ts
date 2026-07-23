import {
  decodeStewardModel,
  decodeStewardProvider,
  decodeStewardDuration,
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
type StewardDuration =
  import("@urban/agentic-memory-core/steward/StewardExecution").StewardDuration;

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

export const timeoutFlag = Flag.string("timeout").pipe(
  Flag.withDescription("Positive finite Memory Steward timeout, for example 30s or 2m"),
  Flag.mapEffect((value) =>
    decodeStewardDuration(value).pipe(
      Effect.mapError(
        () =>
          new CliError.InvalidValue({
            option: "timeout",
            value,
            expected: "positive finite duration such as 30s or 2m",
            kind: "flag",
          }),
      ),
    ),
  ),
  Flag.optional,
);

export const stewardRunOptionsFromInput = (input: {
  readonly provider: Option.Option<StewardProvider>;
  readonly model: Option.Option<StewardModel>;
  readonly thinking: Option.Option<StewardThinkingLevel>;
  readonly timeout: Option.Option<StewardDuration>;
}): StewardRunOptions => ({
  ...(Option.isSome(input.provider) ? { provider: input.provider.value } : {}),
  ...(Option.isSome(input.model) ? { model: input.model.value } : {}),
  ...(Option.isSome(input.thinking) ? { thinking: input.thinking.value } : {}),
  ...(Option.isSome(input.timeout) ? { timeout: input.timeout.value } : {}),
});
