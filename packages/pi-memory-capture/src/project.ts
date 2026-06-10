import { DateTime, Option } from "effect";

const PROJECT_LINK_PATTERN = /^\[\[projects\/([a-z0-9][a-z0-9-]*)\]\]$/;

export const isProjectLink = (value: string): boolean => PROJECT_LINK_PATTERN.test(value);

export const projectSlugFromLink = (value: string) => {
  const match = value.match(PROJECT_LINK_PATTERN);
  return match?.[1] === undefined ? Option.none() : Option.some(match[1]);
};

export const projectLabelFromLink = (value: string) =>
  Option.getOrElse(projectSlugFromLink(value), () => "unknown-project");

export const isAbsolutePath = (value: string) => value.startsWith("/");

export const splitFrontmatter = (content: string) => {
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

export const updateFrontmatterUpdatedDate = (content: string, updated: string) => {
  const { prefix, body } = splitFrontmatter(content);
  if (prefix.length === 0) {
    return content;
  }

  return `${prefix.replace(/^updated:\s*.+$/m, `updated: ${updated}`)}${body}`;
};

const findHeadingIndex = (lines: ReadonlyArray<string>, heading: string) =>
  lines.findIndex((line) => line.trim() === heading);

const findNextHeadingIndex = (lines: ReadonlyArray<string>, fromIndex: number) => {
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
) => [...lines.slice(0, insertIndex), ...sectionLines, ...lines.slice(insertIndex)];

const withProjectsRouteInExistingSection = (lines: ReadonlyArray<string>, routeLine: string) => {
  const headingIndex = findHeadingIndex(lines, "## Projects");
  const endIndex = findNextHeadingIndex(lines, headingIndex);
  const sectionBody = lines.slice(headingIndex + 1, endIndex);

  if (sectionBody.some((line) => line.includes(routeLine))) {
    return lines;
  }

  const before = lines.slice(0, endIndex);
  const after = lines.slice(endIndex);
  const normalizedBefore =
    before.length > 0 && before[before.length - 1]?.trim().length === 0 ? before : [...before, ""];

  return [...normalizedBefore, routeLine, "", ...after];
};

export const ensureProjectRouteInMemory = (
  content: string,
  projectLink: string,
  projectLabel: string,
  updatedDate: string,
) => {
  const routeLine = `- ${projectLink} — ${projectLabel}.`;
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
  return updateFrontmatterUpdatedDate(nextContent, updatedDate);
};

export const buildBuiltinProjectScaffold = ({
  projectLabel,
  date,
}: {
  readonly projectLabel: string;
  readonly date: string;
}) => `---
type: project
status: active
project_status: active
created: ${date}
updated: ${date}
summary: "Agentic Memory capture project for ${projectLabel}."
aliases:
  - "${projectLabel}"
tags: []
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with: []
---

# ${projectLabel}

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

Run /memory-capture after meaningful project work.

## Routing

## Semantic links
`;

export const extractTemplateMarkdown = (templateDocument: string) => {
  const match =
    templateDocument.match(/```md\r?\n([\s\S]*?)\r?\n```/) ??
    templateDocument.match(/```\r?\n([\s\S]*?)\r?\n```/);

  return match?.[1] === undefined ? Option.none() : Option.some(match[1]);
};

const hasRequiredProjectSections = (content: string) =>
  ["## Resume context", "## Project timeline", "## Decision log"].every((heading) =>
    content.includes(heading),
  );

export const applyProjectTemplate = (
  templateDocument: string,
  values: {
    readonly projectLabel: string;
    readonly date: string;
  },
) =>
  Option.flatMap(extractTemplateMarkdown(templateDocument), (template) => {
    const rendered = template
      .replaceAll("YYYY-MM-DD", values.date)
      .replaceAll("Project Name", values.projectLabel)
      .replace(
        'summary: "One-line project summary."',
        `summary: "Agentic Memory capture project for ${values.projectLabel}."`,
      )
      .replace("project_status: candidate", "project_status: active");

    return hasRequiredProjectSections(rendered) ? Option.some(rendered) : Option.none();
  });

export const formatIsoFromMillis = (millis: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(millis));

export const formatIsoDateFromMillis = (millis: number) =>
  DateTime.formatIsoDateUtc(DateTime.makeUnsafe(millis));
