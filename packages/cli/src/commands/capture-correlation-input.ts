import { Config, Effect, Option } from "effect";
import { Flag } from "effect/unstable/cli";

type CaptureCorrelation =
  import("@urban/agentic-memory-core/observability/CaptureTelemetry").CaptureCorrelation;

export const captureAttemptIdFlag = Flag.string("capture-attempt-id").pipe(
  Flag.withDescription("Capture attempt id for telemetry correlation"),
  Flag.optional,
);

export const captureRunIdFlag = Flag.string("capture-run-id").pipe(
  Flag.withDescription("Capture run id for telemetry correlation"),
  Flag.optional,
);

export const captureTriggerKindFlag = Flag.string("capture-trigger-kind").pipe(
  Flag.withDescription("Capture trigger kind for telemetry correlation"),
  Flag.optional,
);

export const captureProjectSlugFlag = Flag.string("capture-project-slug").pipe(
  Flag.withDescription("Linked project slug for telemetry correlation"),
  Flag.optional,
);

const optionalEnvironmentVariable = Effect.fnUntraced(
  function* (name: string) {
    const value = yield* Config.string(name).pipe(Config.option);
    return Option.getOrUndefined(value);
  },
  Effect.orElseSucceed((): string | undefined => undefined),
);

const optionOrEnvironment = (
  value: Option.Option<string>,
  environmentName: string,
): Effect.Effect<string | undefined> =>
  Option.isSome(value) ? Effect.succeed(value.value) : optionalEnvironmentVariable(environmentName);

export const resolveCaptureCorrelation = Effect.fnUntraced(function* (input: {
  readonly attemptId: Option.Option<string>;
  readonly runId: Option.Option<string>;
  readonly triggerKind: Option.Option<string>;
  readonly projectSlug: Option.Option<string>;
}): Effect.fn.Return<CaptureCorrelation | undefined> {
  const attemptId = yield* optionOrEnvironment(
    input.attemptId,
    "AGENTIC_MEMORY_CAPTURE_ATTEMPT_ID",
  );
  const captureRunId = yield* optionOrEnvironment(input.runId, "AGENTIC_MEMORY_CAPTURE_RUN_ID");
  const triggerKind = yield* optionOrEnvironment(
    input.triggerKind,
    "AGENTIC_MEMORY_CAPTURE_TRIGGER_KIND",
  );
  const projectSlug = yield* optionOrEnvironment(
    input.projectSlug,
    "AGENTIC_MEMORY_CAPTURE_PROJECT_SLUG",
  );

  if (
    attemptId === undefined &&
    captureRunId === undefined &&
    triggerKind === undefined &&
    projectSlug === undefined
  ) {
    return undefined;
  }

  return {
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(captureRunId === undefined ? {} : { captureRunId }),
    ...(triggerKind === undefined ? {} : { triggerKind }),
    ...(projectSlug === undefined ? {} : { projectSlug }),
  };
});
