import {
  encodeRunStewardResultJson,
  runSteward,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { exitWith, toFailure, withCliFailureOutput } from "../output.ts";
import { payloadFlag, readPayload } from "./payload-input.ts";
import { projectRootFlag } from "./project-root-input.ts";
import { commandRoot } from "./root.ts";
import {
  captureAttemptIdFlag,
  captureProjectSlugFlag,
  captureRunIdFlag,
  captureTriggerKindFlag,
  modelFlag,
  optionalProjectFlag,
  optionalVaultFlag,
  providerFlag,
  resolveCaptureCorrelation,
  resolveStewardTarget,
  runnerOptionsFromInput,
  thinkingFlag,
  timeoutMillisFlag,
} from "./shared.ts";

export const commandRunSteward = Command.make(
  "run-steward",
  {
    payloadPath: payloadFlag,
    projectRoot: projectRootFlag,
    vault: optionalVaultFlag,
    project: optionalProjectFlag,
    provider: providerFlag,
    model: modelFlag,
    thinking: thinkingFlag,
    timeoutMillis: timeoutMillisFlag,
    captureAttemptId: captureAttemptIdFlag,
    captureRunId: captureRunIdFlag,
    captureTriggerKind: captureTriggerKindFlag,
    captureProjectSlug: captureProjectSlugFlag,
  },
  Effect.fnUntraced(function* (input) {
    const root = yield* commandRoot;
    const payload = yield* readPayload(input.payloadPath);
    const target = yield* resolveStewardTarget({
      vault: input.vault,
      project: input.project,
      projectRoot: input.projectRoot,
    });
    const options = runnerOptionsFromInput({
      provider: input.provider,
      model: input.model,
      thinking: input.thinking,
      timeoutMillis: input.timeoutMillis,
    });
    const correlation = yield* resolveCaptureCorrelation({
      attemptId: input.captureAttemptId,
      runId: input.captureRunId,
      triggerKind: input.captureTriggerKind,
      projectSlug: input.captureProjectSlug,
    });
    const result = yield* runSteward({
      payload,
      vaultPath: target.vaultPath,
      projectSlug: target.projectSlug,
      payloadWarnings: [],
      options,
      ...(correlation === undefined ? {} : { correlation }),
    }).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "RunStewardFailed",
          message: cause.message,
          exitCode: 1,
        }),
      ),
    );
    const jsonText = yield* encodeRunStewardResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode run-steward result: ${cause.message}`,
        }),
      ),
    );
    const humanText =
      result.status === "succeeded"
        ? `Memory Steward ${result.result.status}`
        : "Memory Steward execution failed";

    if (result.status === "succeeded") {
      return yield* Console.log(root.json ? jsonText : humanText);
    }

    if (root.json) {
      yield* Console.log(jsonText);
    }
    yield* Console.error(humanText);
    return yield* exitWith(2);
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Run the isolated Memory Steward process for a capture payload"),
  Command.withExamples([
    {
      command: "agentic-memory run-steward --payload - --project-root . --json",
      description: "Execute the steward with a payload from stdin and JSON output",
    },
    {
      command:
        "agentic-memory run-steward --payload - --vault /vault --project example-project --json",
      description: "Execute the steward using a direct vault and project target",
    },
  ]),
);
