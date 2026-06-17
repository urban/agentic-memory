import { Effect, Path, Schema } from "effect";

const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const ProjectSlug = Schema.String.check(
  Schema.isPattern(PROJECT_SLUG_PATTERN, {
    message: "Expected a bare lowercase project slug like example-project",
  }),
).annotate({ identifier: "ProjectSlug" });
export type ProjectSlug = typeof ProjectSlug.Type;

export const decodeProjectSlug = Schema.decodeUnknownEffect(ProjectSlug);

export const isProjectSlug = (value: string): boolean => PROJECT_SLUG_PATTERN.test(value);

export const projectWikiLinkFromSlug = (slug: ProjectSlug): string => `[[projects/${slug}]]`;

export const projectFileRelativePathFromSlug = (slug: ProjectSlug): string => `projects/${slug}.md`;

export const projectFilePathFromSlug = Effect.fnUntraced(function* (
  vaultPath: string,
  slug: ProjectSlug,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  return path.join(vaultPath, "projects", `${slug}.md`);
});
