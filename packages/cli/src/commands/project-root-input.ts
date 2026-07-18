import { Effect, Path } from "effect";
import { Flag } from "effect/unstable/cli";

export const projectRootFlag = Flag.string("project-root").pipe(
  Flag.withDescription("Project root containing .agentic-memory-link/config.json"),
  Flag.withDefault("."),
);

export const resolveProjectRoot = Effect.fnUntraced(function* (projectRoot: string) {
  const path = yield* Path.Path;
  return path.resolve(projectRoot);
});
