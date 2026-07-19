import { extractBodyCandidates } from "./CandidateExtraction.ts";
import { scoreCandidate, selectedProjectSet } from "./CandidateScoring.ts";
import { classifyRecallLayer } from "./RecallDocuments.ts";
import { detectProjectKeys } from "./QuestionAnalysis.ts";
import { cleanMarkup, countUniqueTokenMatches, tokenize, uniqueStrings } from "./RecallText.ts";

type CandidateDraft = import("./RecallModel.ts").CandidateDraft;
type ParsedRecallDocument = import("./RecallModel.ts").ParsedRecallDocument;
type ProjectEntity = import("./RecallModel.ts").ProjectEntity;
type QuestionAnalysis = import("./RecallModel.ts").QuestionAnalysis;
type RecallCandidate = import("./RecallModel.ts").RecallCandidate;
type RecallCandidateOrigin = import("./RecallModel.ts").RecallCandidateOrigin;
type RouteEntry = import("./RecallModel.ts").RouteEntry;
type RouteExpansion = import("./RecallModel.ts").RouteExpansion;

const documentProjectKeys = (
  document: ParsedRecallDocument,
  projectEntities: ReadonlyArray<ProjectEntity>,
): ReadonlyArray<string> => {
  const identityKeys = detectProjectKeys(
    [document.path, document.title, ...document.aliases].join(" "),
    projectEntities,
  );

  return identityKeys.length > 0
    ? uniqueStrings(identityKeys)
    : uniqueStrings(detectProjectKeys(document.summary ?? "", projectEntities));
};

const normalizeLinkedTarget = (target: string): string | undefined => {
  const withoutHeading = target.split("#")[0]?.trim() ?? "";
  if (withoutHeading.length === 0 || withoutHeading.includes("..")) {
    return undefined;
  }
  if (withoutHeading === "MEMORY" || withoutHeading === "MEMORY.md") {
    return "MEMORY.md";
  }
  if (withoutHeading === "USER" || withoutHeading === "USER.md") {
    return "USER.md";
  }
  const withExtension = withoutHeading.endsWith(".md") ? withoutHeading : `${withoutHeading}.md`;
  return classifyRecallLayer(withExtension) === undefined ? undefined : withExtension;
};

const linkedTargetsFromLine = (line: string): ReadonlyArray<string> =>
  uniqueStrings(
    Array.from(line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu)).flatMap((match) => {
      const target = match[1];
      const normalized = target === undefined ? undefined : normalizeLinkedTarget(target);
      return normalized === undefined ? [] : [normalized];
    }),
  );

const routeEntriesFromDocument = (
  document: ParsedRecallDocument,
  projectEntities: ReadonlyArray<ProjectEntity>,
): ReadonlyArray<RouteEntry> => {
  const documentKeys = documentProjectKeys(document, projectEntities);
  const metadataText = [
    document.title,
    document.summary ?? "",
    ...document.aliases,
    document.status ?? "",
    document.projectStatus ?? "",
  ].join(" ");
  const metadataEntry: RouteEntry = {
    path: document.path,
    tokens: tokenize(metadataText),
    linkedTargets: [document.path],
    projectKeys: documentKeys,
  };
  const lineEntries: Array<RouteEntry> = [];
  let heading = "";
  for (const line of document.body.split(/\r?\n/u)) {
    const headingMatch = line.trim().match(/^#{1,6}\s+(.+)$/u);
    const headingText = headingMatch?.[1];
    if (headingText !== undefined) {
      heading = cleanMarkup(headingText).toLowerCase();
      continue;
    }

    const isRouteSection =
      heading === "routing" ||
      heading === "root routes" ||
      heading === "projects" ||
      heading === "next useful context";
    const isRouteLine = isRouteSection || /\bread when:/iu.test(line);
    const linkedTargets = isRouteLine ? linkedTargetsFromLine(line) : [];
    if (linkedTargets.length > 0) {
      lineEntries.push({
        path: document.path,
        tokens: tokenize(`${metadataText} ${cleanMarkup(line)}`),
        linkedTargets,
        projectKeys: uniqueStrings([...documentKeys, ...detectProjectKeys(line, projectEntities)]),
      });
    }
  }

  return [metadataEntry, ...lineEntries];
};

const strongRouteExpansions = (input: {
  readonly analysis: QuestionAnalysis;
  readonly documents: ReadonlyArray<ParsedRecallDocument>;
  readonly projectEntities: ReadonlyArray<ProjectEntity>;
}): ReadonlyMap<string, RouteExpansion> => {
  const selectedProjects = selectedProjectSet(input.analysis);
  const entries = input.documents.flatMap((document) =>
    routeEntriesFromDocument(document, input.projectEntities),
  );

  return entries.reduce((expansions, entry) => {
    const overlap = countUniqueTokenMatches(input.analysis.tokens, entry.tokens);
    const selectedProjectMatch = entry.projectKeys.some((key) => selectedProjects.has(key));
    const strong = overlap >= 3 || (selectedProjectMatch && overlap >= 2);
    if (!strong) {
      return expansions;
    }

    return entry.linkedTargets.reduce((updated, target) => {
      const current = updated.get(target);
      const next: RouteExpansion = {
        boost: Math.max(current?.boost ?? 0, Math.min(30, 8 + overlap * 4)),
        tokens: uniqueStrings([...(current?.tokens ?? []), ...entry.tokens]),
        projectKeys: uniqueStrings([...(current?.projectKeys ?? []), ...entry.projectKeys]),
      };
      return new Map(updated).set(target, next);
    }, expansions);
  }, new Map<string, RouteExpansion>());
};

const makeCandidateDraft = (input: {
  readonly document: ParsedRecallDocument;
  readonly documentProjectKeys: ReadonlyArray<string>;
  readonly projectEntities: ReadonlyArray<ProjectEntity>;
  readonly text: string;
  readonly origin: RecallCandidateOrigin;
  readonly routeExpansion: RouteExpansion | undefined;
}): CandidateDraft => ({
  path: input.document.path,
  memoryLayer: input.document.memoryLayer,
  metadataTokens: uniqueStrings([
    ...input.document.metadataTokens,
    ...(input.routeExpansion?.tokens ?? []),
  ]),
  origin: input.origin,
  projectKeys: uniqueStrings([
    ...input.documentProjectKeys,
    ...detectProjectKeys(input.text, input.projectEntities),
    ...(input.routeExpansion?.projectKeys ?? []),
  ]),
  projectStatus: input.document.projectStatus,
  status: input.document.status,
  routeBoost: input.routeExpansion?.boost ?? 0,
  text: input.text,
  tokens: tokenize(input.text),
});

const documentCandidates = (
  analysis: QuestionAnalysis,
  projectEntities: ReadonlyArray<ProjectEntity>,
  document: ParsedRecallDocument,
  routeExpansions: ReadonlyMap<string, RouteExpansion>,
): ReadonlyArray<RecallCandidate> => {
  const projectKeys = documentProjectKeys(document, projectEntities);
  const summaryTexts = document.summary === undefined ? [] : [document.summary];
  const drafts: ReadonlyArray<CandidateDraft> = [
    ...summaryTexts.map((text) =>
      makeCandidateDraft({
        document,
        documentProjectKeys: projectKeys,
        origin: "summary",
        projectEntities,
        routeExpansion: routeExpansions.get(document.path),
        text,
      }),
    ),
    ...extractBodyCandidates(document.body, document.memoryLayer).map((candidate) =>
      makeCandidateDraft({
        document,
        documentProjectKeys: projectKeys,
        origin: candidate.origin,
        projectEntities,
        routeExpansion: routeExpansions.get(document.path),
        text: candidate.text,
      }),
    ),
  ];

  return drafts
    .filter((candidate) => candidate.tokens.length > 0)
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate({ analysis, candidate }),
    }));
};

export const rankCandidates = (input: {
  readonly analysis: QuestionAnalysis;
  readonly documents: ReadonlyArray<ParsedRecallDocument>;
  readonly projectEntities: ReadonlyArray<ProjectEntity>;
}): ReadonlyArray<RecallCandidate> => {
  const routeExpansions = strongRouteExpansions(input);
  return input.documents
    .flatMap((document) =>
      documentCandidates(input.analysis, input.projectEntities, document, routeExpansions),
    )
    .filter((candidate) => candidate.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.path.localeCompare(right.path) ||
        left.text.localeCompare(right.text),
    );
};
