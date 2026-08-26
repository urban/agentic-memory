/**
 * Parses authored source content to detect forbidden diagnostic directives and coverage gaps.
 * This exists so the executable source guard and focused tests share the same deterministic rules.
 * Use through `static-analysis-source.ts` or import it in tests for focused validation.
 */
import { parseSync } from "oxc-parser";

type ParsedComment = {
  readonly start: number;
  readonly value: string;
};

export type SourceFile = {
  readonly content: string;
  readonly path: string;
};

export type SourceViolation = {
  readonly location: string;
  readonly message: string;
};

const sourceFilePattern = /\.[cm]?[jt]sx?$/u;
const typedFilePattern = /\.[cm]?tsx?$/u;
const rootToolFiles = new Set([
  "oxfmt.config.ts",
  "oxlint.config.ts",
  "vitest.config.ts",
  "vitest.setup.ts",
]);

const forbiddenDirectives = [
  "@effect-diagnostics",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  "oxlint-disable",
  "oxlint-enable",
  "eslint-disable",
  "eslint-enable",
];

const isCoveredByTypeScript = (path: string) =>
  (path.startsWith("packages/") &&
    (path.includes("/src/") ||
      path.includes("/test/") ||
      path.startsWith("packages/core/scripts/")) &&
    path.endsWith(".ts")) ||
  (path.startsWith("scripts/") && path.endsWith(".ts")) ||
  rootToolFiles.has(path);

const coverageViolations = ({ path }: SourceFile) =>
  typedFilePattern.test(path) && !isCoveredByTypeScript(path)
    ? [
        {
          location: path,
          message: "Authored TypeScript is not covered by a configured TypeScript project.",
        },
      ]
    : [];

const directiveViolations = ({ content, path }: SourceFile) =>
  sourceFilePattern.test(path)
    ? parseSync(path, content).comments.flatMap((comment: ParsedComment) =>
        forbiddenDirectives
          .filter((forbiddenDirective) => comment.value.toLowerCase().includes(forbiddenDirective))
          .map((forbiddenDirective) => ({
            location: `${path}:${content.slice(0, comment.start).split("\n").length}`,
            message: `Static-analysis directive ${JSON.stringify(forbiddenDirective)} is forbidden.`,
          })),
      )
    : [];

export const findSourceViolations = (
  authoredFiles: ReadonlyArray<SourceFile>,
): ReadonlyArray<SourceViolation> => [
  ...authoredFiles.flatMap((file) => coverageViolations(file)),
  ...authoredFiles.flatMap((file) => directiveViolations(file)),
];
