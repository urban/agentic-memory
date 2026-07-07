import { ChildProcessSpawner } from "effect/unstable/process";

type RecallSuccessResponse = import("./RecallSuccessJson.ts").RecallSuccessResponse;

export type GateStatus = "pass" | "fail";

export type HardGateName =
  | "exitCode"
  | "stdoutJson"
  | "status"
  | "answerMustContain"
  | "answerMustNotContain";

export type DecodedRecallOutput =
  | {
      readonly _tag: "decoded";
      readonly response: RecallSuccessResponse;
    }
  | {
      readonly _tag: "decode_failed";
      readonly message: string;
    };

export type HardGateBenchmarkCase = {
  readonly expected: {
    readonly status: "answered";
    readonly answerMustContain: ReadonlyArray<string>;
    readonly answerMustNotContain: ReadonlyArray<string>;
  };
};

export type HardGateExecution = {
  readonly exitCode: ChildProcessSpawner.ExitCode;
  readonly stdout: string;
  readonly decoded: DecodedRecallOutput;
};

export type HardGateResult = {
  readonly name: HardGateName;
  readonly status: GateStatus;
  readonly expected: ReadonlyArray<string>;
  readonly actual: ReadonlyArray<string>;
  readonly message: string;
};

export type HardGateReport = {
  readonly status: GateStatus;
  readonly gates: ReadonlyArray<HardGateResult>;
};

const gateStatus = (violations: ReadonlyArray<string>): GateStatus =>
  violations.length === 0 ? "pass" : "fail";

const makeGate = (
  name: HardGateName,
  violations: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
  actual: ReadonlyArray<string>,
  passMessage: string,
  failMessage: string,
): HardGateResult => ({
  name,
  status: gateStatus(violations),
  expected,
  actual,
  message: violations.length === 0 ? passMessage : failMessage,
});

const normalizeAnswerText = (input: string): string =>
  input.toLowerCase().replace(/\s+/gu, " ").trim();

export const evaluateHardGates = (input: {
  readonly benchmarkCase: HardGateBenchmarkCase;
  readonly execution: HardGateExecution;
}): HardGateReport => {
  const decodedResponse =
    input.execution.decoded._tag === "decoded" ? input.execution.decoded.response : undefined;
  const normalizedAnswer =
    decodedResponse === undefined ? undefined : normalizeAnswerText(decodedResponse.answer);
  const missingRequired =
    normalizedAnswer === undefined
      ? [...input.benchmarkCase.expected.answerMustContain]
      : input.benchmarkCase.expected.answerMustContain.filter(
          (requiredFact) => !normalizedAnswer.includes(normalizeAnswerText(requiredFact)),
        );
  const presentForbidden =
    normalizedAnswer === undefined
      ? [...input.benchmarkCase.expected.answerMustNotContain]
      : input.benchmarkCase.expected.answerMustNotContain.filter((forbiddenFact) =>
          normalizedAnswer.includes(normalizeAnswerText(forbiddenFact)),
        );
  const gates = [
    makeGate(
      "exitCode",
      input.execution.exitCode === ChildProcessSpawner.ExitCode(0)
        ? []
        : [String(input.execution.exitCode)],
      ["0"],
      [String(input.execution.exitCode)],
      "CLI exited with code 0.",
      "CLI exited with a nonzero code.",
    ),
    makeGate(
      "stdoutJson",
      input.execution.decoded._tag === "decoded" ? [] : [input.execution.decoded.message],
      ["RecallSuccessJson"],
      input.execution.decoded._tag === "decoded"
        ? ["RecallSuccessJson"]
        : [input.execution.decoded.message],
      "stdout decoded as RecallSuccessJson.",
      "stdout did not decode as RecallSuccessJson.",
    ),
    makeGate(
      "status",
      decodedResponse?.status === input.benchmarkCase.expected.status
        ? []
        : [input.benchmarkCase.expected.status],
      [input.benchmarkCase.expected.status],
      decodedResponse === undefined ? [] : [decodedResponse.status],
      "Recall status matched the benchmark expectation.",
      "Recall status did not match the benchmark expectation.",
    ),
    makeGate(
      "answerMustContain",
      missingRequired,
      input.benchmarkCase.expected.answerMustContain,
      decodedResponse === undefined ? [] : [decodedResponse.answer],
      "Answer included every required fact.",
      "Answer did not include every required fact.",
    ),
    makeGate(
      "answerMustNotContain",
      presentForbidden,
      input.benchmarkCase.expected.answerMustNotContain,
      decodedResponse === undefined ? [] : [decodedResponse.answer],
      "Answer excluded every forbidden fact.",
      "Answer included forbidden facts or could not be inspected.",
    ),
  ];

  return {
    status: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
    gates,
  };
};
