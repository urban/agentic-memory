export type GateStatus = "pass" | "fail";

export type HardGateName =
  | "mustInclude"
  | "mustNotInclude"
  | "preferredTop1"
  | "sourceLeakage"
  | "vaultRelativePaths";

export type HardGateBenchmarkCase = {
  readonly includeSources?: boolean | undefined;
  readonly expected: {
    readonly mustInclude: ReadonlyArray<string>;
    readonly mustNotInclude: ReadonlyArray<string>;
    readonly preferredTop1?: string | undefined;
  };
};

export type HardGateRetrievalResult = {
  readonly path: string;
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

const managedPrefixes = ["maps/", "projects/", "notes/", "people/", "records/", "sources/"];

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

const isVaultRelativeMarkdownPath = (relativePath: string): boolean => {
  const segments = relativePath.split("/");

  return (
    relativePath.endsWith(".md") &&
    !relativePath.startsWith("/") &&
    !relativePath.startsWith(".") &&
    !relativePath.includes("\\") &&
    !segments.includes("..") &&
    segments.every((segment) => segment.length > 0)
  );
};

const isManagedMemoryPath = (relativePath: string): boolean =>
  isVaultRelativeMarkdownPath(relativePath) &&
  (relativePath === "MEMORY.md" ||
    relativePath === "USER.md" ||
    managedPrefixes.some((prefix) => relativePath.startsWith(prefix)));

const preferredTop1Gate = (
  preferredTop1: string | undefined,
  topPath: string | undefined,
): ReadonlyArray<HardGateResult> =>
  preferredTop1 === undefined
    ? []
    : [
        makeGate(
          "preferredTop1",
          topPath === preferredTop1 ? [] : [preferredTop1],
          [preferredTop1],
          topPath === undefined ? [] : [topPath],
          "Preferred top-1 result matched.",
          "Preferred top-1 result did not match.",
        ),
      ];

export const evaluateHardGates = (input: {
  readonly benchmarkCase: HardGateBenchmarkCase;
  readonly results: ReadonlyArray<HardGateRetrievalResult>;
}): HardGateReport => {
  const paths = input.results.map((result) => result.path);
  const missingRequired = input.benchmarkCase.expected.mustInclude.filter(
    (expectedPath) => !paths.includes(expectedPath),
  );
  const presentForbidden = input.benchmarkCase.expected.mustNotInclude.filter((forbiddenPath) =>
    paths.includes(forbiddenPath),
  );
  const sourceLeaks =
    input.benchmarkCase.includeSources === true
      ? []
      : paths.filter((resultPath) => resultPath.startsWith("sources/"));
  const invalidPaths = paths.filter((relativePath) => !isManagedMemoryPath(relativePath));
  const gates = [
    makeGate(
      "mustInclude",
      missingRequired,
      input.benchmarkCase.expected.mustInclude,
      paths,
      "All required files were returned.",
      "One or more required files were missing.",
    ),
    makeGate(
      "mustNotInclude",
      presentForbidden,
      input.benchmarkCase.expected.mustNotInclude,
      presentForbidden,
      "No forbidden files were returned.",
      "One or more forbidden files were returned.",
    ),
    ...preferredTop1Gate(input.benchmarkCase.expected.preferredTop1, paths[0]),
    makeGate(
      "sourceLeakage",
      sourceLeaks,
      [],
      sourceLeaks,
      "No source files leaked into default retrieval.",
      "Source files leaked into default retrieval.",
    ),
    makeGate(
      "vaultRelativePaths",
      invalidPaths,
      [],
      invalidPaths,
      "All result paths were valid vault-relative managed memory paths.",
      "One or more result paths were invalid.",
    ),
  ];

  return {
    status: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
    gates,
  };
};
