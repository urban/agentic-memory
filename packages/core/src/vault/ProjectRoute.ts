import { DateTime, Effect, FileSystem, Option, Path, Schema } from "effect";
import { projectFileRelativePathFromSlug, projectWikiLinkFromSlug } from "../link/ProjectSlug.ts";

type ProjectSlug = import("../link/ProjectSlug.ts").ProjectSlug;

export class ProjectRouteError extends Schema.TaggedErrorClass<ProjectRouteError>()(
  "ProjectRouteError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export const formatIsoDateFromMillis = (millis: number): string =>
  DateTime.formatIsoDateUtc(DateTime.makeUnsafe(millis));

export const splitFrontmatter = (
  content: string,
): {
  readonly prefix: string;
  readonly body: string;
} => {
  if (!content.startsWith("---\n")) {
    return { prefix: "", body: content };
  }

  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { prefix: "", body: content };
  }

  const prefixEnd = endIndex + "\n---\n".length;
  return {
    prefix: content.slice(0, prefixEnd),
    body: content.slice(prefixEnd),
  };
};

export const updateFrontmatterUpdatedDate = (content: string, updated: string): string => {
  const { prefix, body } = splitFrontmatter(content);
  if (prefix.length === 0 || !/^updated:\s*.+$/m.test(prefix)) {
    return content;
  }

  return `${prefix.replace(/^updated:\s*.+$/m, `updated: ${updated}`)}${body}`;
};

const findHeadingIndex = (lines: ReadonlyArray<string>, heading: string): number =>
  lines.findIndex((line) => line.trim() === heading);

const findNextHeadingIndex = (lines: ReadonlyArray<string>, fromIndex: number): number => {
  let index = fromIndex + 1;

  while (index < lines.length) {
    if (lines[index]?.startsWith("## ")) {
      return index;
    }
    index += 1;
  }

  return lines.length;
};

const insertSectionLines = (
  lines: ReadonlyArray<string>,
  insertIndex: number,
  sectionLines: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  ...lines.slice(0, insertIndex),
  ...sectionLines,
  ...lines.slice(insertIndex),
];

const projectRouteLine = (slug: ProjectSlug): string =>
  `- ${projectWikiLinkFromSlug(slug)} — ${slug}.`;

const hasProjectRouteInLines = (lines: ReadonlyArray<string>, slug: ProjectSlug): boolean => {
  const headingIndex = findHeadingIndex(lines, "## Projects");
  if (headingIndex < 0) {
    return false;
  }

  const endIndex = findNextHeadingIndex(lines, headingIndex);
  const routeLine = projectRouteLine(slug);
  return lines.slice(headingIndex + 1, endIndex).some((line) => line.trim() === routeLine);
};

export const hasProjectRouteInMemory = (content: string, slug: ProjectSlug): boolean => {
  const { body } = splitFrontmatter(content);
  return hasProjectRouteInLines(body.split("\n"), slug);
};

const withProjectsRouteInExistingSection = (
  lines: ReadonlyArray<string>,
  routeLine: string,
): ReadonlyArray<string> => {
  const headingIndex = findHeadingIndex(lines, "## Projects");
  const endIndex = findNextHeadingIndex(lines, headingIndex);
  const before = lines.slice(0, endIndex);
  const after = lines.slice(endIndex);
  const normalizedBefore =
    before.length > 0 && before[before.length - 1]?.trim().length === 0 ? before : [...before, ""];

  return [...normalizedBefore, routeLine, "", ...after];
};

export const ensureProjectRouteInMemory = (
  content: string,
  slug: ProjectSlug,
  updatedDate: string,
): {
  readonly content: string;
  readonly added: boolean;
} => {
  if (hasProjectRouteInMemory(content, slug)) {
    return { content, added: false };
  }

  const routeLine = projectRouteLine(slug);
  const { prefix, body } = splitFrontmatter(content);
  const lines = body.split("\n");
  const nextLines =
    findHeadingIndex(lines, "## Projects") >= 0
      ? withProjectsRouteInExistingSection(lines, routeLine)
      : (() => {
          const projectsSection = ["", "## Projects", "", routeLine, ""];
          const routesIndex = findHeadingIndex(lines, "## Routes");

          if (routesIndex >= 0) {
            const insertIndex = findNextHeadingIndex(lines, routesIndex);
            return insertSectionLines(lines, insertIndex, projectsSection);
          }

          const currentIndex = findHeadingIndex(lines, "## Current");
          if (currentIndex >= 0) {
            return insertSectionLines(lines, currentIndex, projectsSection);
          }

          return [...lines, ...projectsSection];
        })();

  const nextContent = `${prefix}${nextLines.join("\n")}`.replace(/\n{3,}/g, "\n\n");
  return {
    content: updateFrontmatterUpdatedDate(nextContent, updatedDate),
    added: true,
  };
};

export const buildBuiltinProjectScaffold = ({
  slug,
  date,
}: {
  readonly slug: ProjectSlug;
  readonly date: string;
}): string => `---
type: project
status: active
project_status: active
created: ${date}
updated: ${date}
summary: "Agentic Memory capture project for ${slug}."
aliases:
  - "${slug}"
tags: []
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with: []
---

# ${slug}

## Purpose

Project initialized for Agentic Memory capture.

## Resume context

No durable resume context captured yet.

## Active goals

- Capture durable project decisions, rationale, open questions, and reusable memory.

## Project timeline

- ${date}: Project initialized for Agentic Memory capture.

## Decision log

No consequential decisions captured yet.

## Open questions

- What durable project context should future sessions preserve?

## Next useful context

Run agentic-memory capture after meaningful project work.

## Routing

## Semantic links
`;

export const extractTemplateMarkdown = (templateDocument: string): Option.Option<string> => {
  const match =
    templateDocument.match(/```md\r?\n([\s\S]*?)\r?\n```/) ??
    templateDocument.match(/```\r?\n([\s\S]*?)\r?\n```/);

  return match?.[1] === undefined ? Option.none() : Option.some(match[1]);
};

const hasRequiredProjectSections = (content: string): boolean =>
  ["## Resume context", "## Project timeline", "## Decision log"].every((heading) =>
    content.includes(heading),
  );

const hasProjectTemplatePlaceholders = (content: string): boolean =>
  content.includes("[[notes/example]]") || content.includes("[[projects/example]]");

export const applyProjectTemplate = (
  templateDocument: string,
  values: {
    readonly slug: ProjectSlug;
    readonly date: string;
  },
): Option.Option<string> =>
  Option.flatMap(extractTemplateMarkdown(templateDocument), (template) => {
    const rendered = template
      .replaceAll("YYYY-MM-DD", values.date)
      .replaceAll("Project Name", values.slug)
      .replace(
        'summary: "One-line project summary."',
        `summary: "Agentic Memory capture project for ${values.slug}."`,
      )
      .replace("project_status: candidate", "project_status: active");

    return hasRequiredProjectSections(rendered) && !hasProjectTemplatePlaceholders(rendered)
      ? Option.some(rendered)
      : Option.none();
  });

export const projectFilePath = Effect.fnUntraced(function* (
  vaultPath: string,
  slug: ProjectSlug,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  return path.join(vaultPath, projectFileRelativePathFromSlug(slug));
});

export const ensureProjectFile = Effect.fnUntraced(function* (input: {
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
  readonly date: string;
}): Effect.fn.Return<boolean, ProjectRouteError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filepath = yield* projectFilePath(input.vaultPath, input.projectSlug);
  const alreadyExists = yield* fs.exists(filepath).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectRouteError({
          message: `Failed to inspect project file: ${filepath}`,
          cause,
        }),
    ),
  );

  if (alreadyExists) {
    return false;
  }

  const templatePath = path.join(input.vaultPath, ".agentic-memory", "templates", "project.md");
  const templateExists = yield* fs.exists(templatePath).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectRouteError({
          message: `Failed to inspect project template: ${templatePath}`,
          cause,
        }),
    ),
  );
  const templateDocument = templateExists
    ? yield* fs.readFileString(templatePath).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectRouteError({
              message: `Failed to read project template: ${templatePath}`,
              cause,
            }),
        ),
      )
    : undefined;
  const scaffold = Option.getOrElse(
    templateDocument === undefined
      ? Option.none()
      : applyProjectTemplate(templateDocument, {
          slug: input.projectSlug,
          date: input.date,
        }),
    () => buildBuiltinProjectScaffold({ slug: input.projectSlug, date: input.date }),
  );

  yield* fs.makeDirectory(path.dirname(filepath), { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectRouteError({
          message: `Failed to create project directory for: ${filepath}`,
          cause,
        }),
    ),
  );
  yield* fs.writeFileString(filepath, scaffold).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectRouteError({
          message: `Failed to write project file: ${filepath}`,
          cause,
        }),
    ),
  );

  return true;
});

export const ensureMemoryRoute = Effect.fnUntraced(function* (input: {
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
  readonly date: string;
}): Effect.fn.Return<boolean, ProjectRouteError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const memoryPath = path.join(input.vaultPath, "MEMORY.md");
  const contents = yield* fs.readFileString(memoryPath).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectRouteError({
          message: `Failed to read vault MEMORY.md: ${memoryPath}`,
          cause,
        }),
    ),
  );
  const updated = ensureProjectRouteInMemory(contents, input.projectSlug, input.date);

  if (!updated.added) {
    return false;
  }

  yield* fs.writeFileString(memoryPath, updated.content).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectRouteError({
          message: `Failed to update vault MEMORY.md: ${memoryPath}`,
          cause,
        }),
    ),
  );
  return true;
});
