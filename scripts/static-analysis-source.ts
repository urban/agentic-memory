/**
 * Scans authored TypeScript and JavaScript for forbidden diagnostic directives and coverage gaps.
 * This exists so inline bypasses fail before formatting, linting, typechecking, or tests can pass.
 * Use through `bun run check:static-analysis` or execute this script directly with Bun.
 */
import { findSourceViolations } from "./static-analysis-source-core";

const root = new URL("../", import.meta.url).pathname;
const gitFiles = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
});
const authoredPaths = gitFiles.stdout
  .toString()
  .split("\n")
  .filter((path) => path.length > 0);
const authoredPathExists = await Promise.all(
  authoredPaths.map((path) => Bun.file(`${root}${path}`).exists()),
);
const existingAuthoredPaths = authoredPaths.filter(
  (_, index) => authoredPathExists[index] === true,
);
const authoredFiles = await Promise.all(
  existingAuthoredPaths.map((path) =>
    Bun.file(`${root}${path}`)
      .text()
      .then((content) => ({ content, path })),
  ),
);
const gitViolations = gitFiles.success
  ? []
  : [
      {
        location: "git",
        message: `Unable to enumerate authored files: ${gitFiles.stderr.toString().trim()}`,
      },
    ];
const violations = [...findSourceViolations(authoredFiles), ...gitViolations];

if (violations.length > 0) {
  const report = violations.map(({ location, message }) => `- ${location}: ${message}`).join("\n");
  await Bun.write(Bun.stderr, `Static-analysis source check failed:\n${report}\n`);
  globalThis.process.exitCode = 1;
}
