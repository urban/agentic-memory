import {
  encodeRunStewardResultJson,
  runSteward,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { exitWith, toFailure, withCliFailureOutput } from "../output.ts";
import {
  captureAttemptIdFlag,
  captureRunIdFlag,
  captureTriggerKindFlag,
  resolveCaptureCorrelation,
} from "./capture-correlation-input.ts";
import { payloadFlag, readPayload } from "./payload-input.ts";
import { commandRoot } from "./root.ts";
import {
  modelFlag,
  providerFlag,
  stewardRunOptionsFromInput,
  thinkingFlag,
  timeoutFlag,
} from "./steward-options-input.ts";
import {
  optionalProjectFlag,
  optionalVaultFlag,
  resolveStewardTarget,
} from "./steward-target-input.ts";

export const commandRunSteward = Command.make(
  "run-steward",
  {
    payloadPath: payloadFlag,
    vault: optionalVaultFlag,
    project: optionalProjectFlag,
    provider: providerFlag,
    model: modelFlag,
    thinking: thinkingFlag,
    timeout: timeoutFlag,
    captureAttemptId: captureAttemptIdFlag,
    captureRunId: captureRunIdFlag,
    captureTriggerKind: captureTriggerKindFlag,
  },
  Effect.fnUntraced(function* (input) {
    const root = yield* commandRoot;
    const payload = yield* readPayload(root.directory.path, input.payloadPath);
    const target = yield* resolveStewardTarget({
      vault: input.vault,
      project: input.project,
      directory: root.directory,
    });
    const options = stewardRunOptionsFromInput({
      provider: input.provider,
      model: input.model,
      thinking: input.thinking,
      timeout: input.timeout,
    });
    const correlation = yield* resolveCaptureCorrelation({
      attemptId: input.captureAttemptId,
      runId: input.captureRunId,
      triggerKind: input.captureTriggerKind,
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
      command: "agentic-memory -C . run-steward --payload - --json",
      description: "Execute the steward with a payload from stdin and JSON output",
    },
    {
      command:
        "agentic-memory -C /work run-steward --payload payload.json --vault ../vault --project example-project --json",
      description: "Execute the steward using a direct vault and project target",
    },
    {
      command: "agentic-memory -C . run-steward --payload - --timeout 30s --json",
      description: "Execute the steward with a 30-second timeout (units such as 2m are supported)",
    },
  ]),
);
