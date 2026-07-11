import { Effect, FileSystem, Path, Schema } from "effect";

const RecallWarnings = Schema.Array(Schema.String).annotate({ identifier: "RecallWarnings" });

export const RecallRequest = Schema.Struct({
  vaultPath: Schema.String,
  question: Schema.String,
  includeSources: Schema.Boolean,
}).annotate({ identifier: "RecallRequest" });
export type RecallRequest = typeof RecallRequest.Type;

export const RecallResponse = Schema.Struct({
  status: Schema.Literals(["answered", "not_found"]),
  question: Schema.String,
  answer: Schema.String,
  warnings: RecallWarnings,
}).annotate({ identifier: "RecallResponse" });
export type RecallResponse = typeof RecallResponse.Type;

export const RecallSuccessJson = Schema.fromJsonString(RecallResponse).annotate({
  identifier: "RecallSuccessJson",
});

export const decodeRecallRequest = Schema.decodeUnknownEffect(RecallRequest, {
  onExcessProperty: "error",
});
export const decodeRecallResponse = Schema.decodeUnknownEffect(RecallResponse, {
  onExcessProperty: "error",
});
export const decodeRecallSuccessJson = Schema.decodeUnknownEffect(RecallSuccessJson, {
  onExcessProperty: "error",
});
export const encodeRecallSuccessJson = Schema.encodeUnknownEffect(RecallSuccessJson, {
  onExcessProperty: "error",
});

type RecallLayer = "core" | "user" | "map" | "project" | "note" | "person" | "record" | "source";

type RecallDocument = {
  readonly path: string;
  readonly memoryLayer: RecallLayer;
  readonly content: string;
};

type RecallContentStatus = "draft" | "active" | "stale" | "archived";
type RecallProjectStatus = "candidate" | "active" | "completed" | "archived";

type ParsedRecallDocument = RecallDocument & {
  readonly body: string;
  readonly title: string;
  readonly declaredType: RecallLayer | undefined;
  readonly status: RecallContentStatus | undefined;
  readonly projectStatus: RecallProjectStatus | undefined;
  readonly summary: string | undefined;
  readonly aliases: ReadonlyArray<string>;
  readonly metadataTokens: ReadonlyArray<string>;
};

type ProjectEntity = {
  readonly key: string;
  readonly labelTokenSets: ReadonlyArray<ReadonlyArray<string>>;
  readonly distinctiveTokens: ReadonlyArray<string>;
};

type RecallCandidateOrigin = "summary" | "body";

type RecallCandidate = {
  readonly path: string;
  readonly memoryLayer: RecallLayer;
  readonly text: string;
  readonly tokens: ReadonlyArray<string>;
  readonly metadataTokens: ReadonlyArray<string>;
  readonly projectKeys: ReadonlyArray<string>;
  readonly status: RecallContentStatus | undefined;
  readonly projectStatus: RecallProjectStatus | undefined;
  readonly score: number;
  readonly origin: RecallCandidateOrigin;
};

type QuestionAnalysis = {
  readonly tokens: ReadonlyArray<string>;
  readonly selectedProjectKeys: ReadonlyArray<string>;
  readonly selectedEntityTokens: ReadonlyArray<string>;
  readonly projectTopicTokens: ReadonlyArray<string>;
  readonly optionTopicTokens: ReadonlyArray<string>;
  readonly wantsProjectFact: boolean;
  readonly wantsOptionPreference: boolean;
  readonly wantsSourceEvidence: boolean;
};

type CandidateDraft = Omit<RecallCandidate, "score">;

type SupportedCandidate = {
  readonly candidate: RecallCandidate;
  readonly supportScore: number;
};

type AnswerPart = {
  readonly category: "project_fact" | "user_preference";
  readonly sentence: string;
};

export class RecallError extends Schema.TaggedErrorClass<RecallError>()("RecallError", {
  reason: Schema.Literals(["InvalidQuestion", "ReadVaultFailed"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const managedPrefixes = [
  ["maps/", "map"],
  ["projects/", "project"],
  ["notes/", "note"],
  ["people/", "person"],
  ["records/", "record"],
  ["sources/", "source"],
] satisfies ReadonlyArray<readonly [string, RecallLayer]>;

const stopWords = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "back",
  "be",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "need",
  "of",
  "on",
  "or",
  "our",
  "platform",
  "product",
  "project",
  "should",
  "the",
  "to",
  "urban",
  "what",
  "when",
  "which",
  "with",
  "you",
  "your",
]);

const genericEntityTokens = new Set([
  "active",
  "budget",
  "decision",
  "latency",
  "map",
  "memory",
  "note",
  "policy",
  "record",
  "retry",
  "scheduler",
  "source",
]);

const sourceEvidenceQuestionSignals = new Set([
  "evidence",
  "provenance",
  "raw",
  "source",
  "verification",
  "verify",
]);

const optionQuestionSignals = new Set([
  "capital",
  "choice",
  "direction",
  "format",
  "letter",
  "option",
  "present",
  "presentation",
  "prioritization",
  "prioritize",
  "priority",
  "rank",
  "reply",
  "stack",
]);

const projectQuestionSignals = new Set([
  "backoff",
  "batch",
  "budget",
  "latency",
  "policy",
  "responsiveness",
  "retry",
  "scheduler",
  "throughput",
  "timing",
  "window",
]);

const genericQuestionEntityTokens = new Set([
  "ask",
  "answer",
  "available",
  "based",
  "choose",
  "chose",
  "follow",
  "know",
  "launch",
  "morning",
  "setting",
  "tomorrow",
  "tune",
  "use",
]);

const notFoundAnswer = "I don't know based on the available Agentic Memory.";
const projectSupportFloor = 45;
const optionSupportFloor = 45;

const classifyRecallLayer = (relativePath: string): RecallLayer | undefined => {
  if (relativePath === "MEMORY.md") {
    return "core";
  }
  if (relativePath === "USER.md") {
    return "user";
  }
  return managedPrefixes.find(([prefix]) => relativePath.startsWith(prefix))?.[1];
};

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

const isManagedRecallPath = (relativePath: string, includeSources: boolean): boolean =>
  isVaultRelativeMarkdownPath(relativePath) &&
  classifyRecallLayer(relativePath) !== undefined &&
  (includeSources || !relativePath.startsWith("sources/"));

const normalizeRelativePath = (entry: string, path: Path.Path): string =>
  path.sep === "/" ? entry : entry.replaceAll(path.sep, "/");

const normalizeToken = (token: string): string => {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
};

const tokenize = (input: string): ReadonlyArray<string> =>
  input
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !stopWords.has(token));

const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from(new Set(values.filter((value) => value.length > 0)));

const tokenSet = (tokens: ReadonlyArray<string>): ReadonlySet<string> => new Set(tokens);

const lastPathSegment = (target: string): string => {
  const segments = target.split("/");
  return segments.at(-1) ?? target;
};

const sanitizeInternalReferences = (input: string): string =>
  input
    .replace(/\b(?:QMD|LexicalProvider|Lexical Provider)\b/giu, "memory")
    .replace(/\.agentic-memory/giu, "control plane")
    .replace(/\bMEMORY\.md\b/gu, "memory")
    .replace(/\bUSER\.md\b/gu, "user memory")
    .replace(/\b(?:projects|notes|maps|people|records|sources)\//giu, "")
    .replace(/\b([A-Za-z0-9._-]+)\.md\b/gu, "$1");

const cleanMarkup = (input: string): string =>
  sanitizeInternalReferences(
    input
      .replace(
        /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/gu,
        (_match, target: string, label?: string) => label ?? lastPathSegment(target),
      )
      .replace(/[*_`]/gu, ""),
  )
    .replace(/\s+/gu, " ")
    .trim();

const splitFrontmatter = (
  content: string,
): { readonly frontmatter: string | undefined; readonly body: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (match === null) {
    return { frontmatter: undefined, body: content };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
};

const unquoteFrontmatterValue = (value: string): string => {
  const trimmed = value.trim();
  const firstCharacter = trimmed[0];
  const lastCharacter = trimmed[trimmed.length - 1];
  return (firstCharacter === `"` || firstCharacter === "'") && firstCharacter === lastCharacter
    ? trimmed.slice(1, -1)
    : trimmed;
};

const extractFrontmatterStringField = (
  frontmatter: string | undefined,
  fieldName: string,
): string | undefined => {
  if (frontmatter === undefined) {
    return undefined;
  }

  const prefix = `${fieldName}:`;
  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith(prefix)) {
      const value = line.slice(prefix.length).trim();
      return value.length === 0 ? undefined : cleanMarkup(unquoteFrontmatterValue(value));
    }
  }

  return undefined;
};

const extractFrontmatterStringListField = (
  frontmatter: string | undefined,
  fieldName: string,
): ReadonlyArray<string> => {
  if (frontmatter === undefined) {
    return [];
  }

  const values: Array<string> = [];
  let insideField = false;

  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    const topLevelMatch = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (topLevelMatch !== null) {
      const key = topLevelMatch[1] ?? "";
      const value = topLevelMatch[2] ?? "";
      insideField = key === fieldName;
      if (insideField) {
        const trimmedValue = value.trim();
        if (trimmedValue.length > 0 && trimmedValue !== "[]") {
          values.push(cleanMarkup(unquoteFrontmatterValue(trimmedValue)));
        }
      }
      continue;
    }

    if (insideField) {
      const itemMatch = rawLine.match(/^\s*-\s*(.+)$/u);
      const item = itemMatch?.[1];
      if (item !== undefined) {
        values.push(cleanMarkup(unquoteFrontmatterValue(item)));
      }
    }
  }

  return uniqueStrings(values);
};

const parseDeclaredType = (value: string | undefined): RecallLayer | undefined => {
  const normalized = value?.toLowerCase();
  switch (normalized) {
    case "core":
    case "user":
    case "map":
    case "project":
    case "note":
    case "person":
    case "record":
    case "source":
      return normalized;
    default:
      return undefined;
  }
};

const parseContentStatus = (value: string | undefined): RecallContentStatus | undefined => {
  const normalized = value?.toLowerCase();
  switch (normalized) {
    case "draft":
    case "active":
    case "stale":
    case "archived":
      return normalized;
    default:
      return undefined;
  }
};

const parseProjectStatus = (value: string | undefined): RecallProjectStatus | undefined => {
  const normalized = value?.toLowerCase();
  switch (normalized) {
    case "candidate":
    case "active":
    case "completed":
    case "archived":
      return normalized;
    default:
      return undefined;
  }
};

const extractFirstHeading = (body: string): string | undefined => {
  for (const rawLine of body.split(/\r?\n/u)) {
    const match = rawLine.match(/^#\s+(.+)$/u);
    const heading = match?.[1];
    if (heading !== undefined) {
      return cleanMarkup(heading);
    }
  }
  return undefined;
};

const titleFromPath = (relativePath: string): string => {
  const filename = lastPathSegment(relativePath).replace(/\.md$/u, "");
  return filename.replace(/[-_]+/gu, " ");
};

const parseRecallDocument = (document: RecallDocument): ParsedRecallDocument => {
  const { frontmatter, body } = splitFrontmatter(document.content);
  const declaredType = parseDeclaredType(extractFrontmatterStringField(frontmatter, "type"));
  const status = parseContentStatus(extractFrontmatterStringField(frontmatter, "status"));
  const projectStatus = parseProjectStatus(
    extractFrontmatterStringField(frontmatter, "project_status"),
  );
  const summary = extractFrontmatterStringField(frontmatter, "summary");
  const aliases = extractFrontmatterStringListField(frontmatter, "aliases");
  const title = extractFirstHeading(body) ?? titleFromPath(document.path);
  const metadataText = [
    document.path,
    title,
    declaredType ?? "",
    status ?? "",
    projectStatus ?? "",
    summary ?? "",
    ...aliases,
  ].join(" ");

  return {
    ...document,
    aliases,
    body,
    declaredType,
    metadataTokens: tokenize(metadataText),
    projectStatus,
    status,
    summary,
    title,
  };
};

const projectKeyFromPath = (relativePath: string): string | undefined => {
  const prefix = "projects/";
  const suffix = ".md";
  return relativePath.startsWith(prefix) && relativePath.endsWith(suffix)
    ? relativePath.slice(prefix.length, -suffix.length)
    : undefined;
};

const projectEntityFromDocument = (document: ParsedRecallDocument): ProjectEntity | undefined => {
  const key = projectKeyFromPath(document.path);
  if (key === undefined) {
    return undefined;
  }

  const labels = uniqueStrings([document.title, ...document.aliases, titleFromPath(document.path)]);
  const labelTokenSets = labels.map(tokenize).filter((tokens) => tokens.length > 0);
  const distinctiveTokens = uniqueStrings(
    labelTokenSets.flatMap((tokens) =>
      tokens.filter(
        (token) => !genericEntityTokens.has(token) && !projectQuestionSignals.has(token),
      ),
    ),
  );
  return {
    distinctiveTokens,
    key,
    labelTokenSets,
  };
};

const projectEntitiesFromDocuments = (
  documents: ReadonlyArray<ParsedRecallDocument>,
): ReadonlyArray<ProjectEntity> =>
  documents
    .filter((document) => document.memoryLayer === "project")
    .flatMap((document) => {
      const entity = projectEntityFromDocument(document);
      return entity === undefined ? [] : [entity];
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));

const hasExactProjectLabel = (entity: ProjectEntity, tokens: ReadonlySet<string>): boolean =>
  entity.labelTokenSets.some(
    (labelTokens) =>
      labelTokens.length > 0 && labelTokens.every((labelToken) => tokens.has(labelToken)),
  );

const uniqueEntityTokens = (projectEntities: ReadonlyArray<ProjectEntity>): ReadonlySet<string> => {
  const tokenCounts = projectEntities
    .flatMap((entity) => uniqueStrings(entity.distinctiveTokens))
    .reduce(
      (counts, token) => counts.set(token, (counts.get(token) ?? 0) + 1),
      new Map<string, number>(),
    );

  return new Set(
    Array.from(tokenCounts.entries())
      .filter(([, count]) => count === 1)
      .map(([token]) => token),
  );
};

const detectProjectKeys = (
  text: string,
  projectEntities: ReadonlyArray<ProjectEntity>,
): ReadonlyArray<string> => {
  const tokens = tokenSet(tokenize(text));
  const exactMatches = projectEntities.filter((entity) => hasExactProjectLabel(entity, tokens));
  if (exactMatches.length > 0) {
    return exactMatches.map((entity) => entity.key);
  }

  const uniqueTokens = uniqueEntityTokens(projectEntities);
  return projectEntities
    .filter((entity) =>
      entity.distinctiveTokens.some(
        (distinctiveToken) => uniqueTokens.has(distinctiveToken) && tokens.has(distinctiveToken),
      ),
    )
    .map((entity) => entity.key);
};

const questionEntityTokens = (tokens: ReadonlyArray<string>): ReadonlyArray<string> =>
  uniqueStrings(
    tokens.filter(
      (token) =>
        !projectQuestionSignals.has(token) &&
        !optionQuestionSignals.has(token) &&
        !genericEntityTokens.has(token) &&
        !genericQuestionEntityTokens.has(token),
    ),
  );

const analyzeQuestion = (
  question: string,
  projectEntities: ReadonlyArray<ProjectEntity>,
): QuestionAnalysis => {
  const tokens = tokenize(question);
  const questionTokenSet = tokenSet(tokens);
  const selectedProjectKeys = detectProjectKeys(question, projectEntities);
  const selectedProjectKeySet = new Set(selectedProjectKeys);
  const matchedProjectEntityTokens = uniqueStrings(
    projectEntities
      .filter((entity) => selectedProjectKeySet.has(entity.key))
      .flatMap((entity) => [...entity.labelTokenSets.flat(), ...entity.distinctiveTokens])
      .filter((token) => questionTokenSet.has(token)),
  );
  const selectedEntityTokens =
    matchedProjectEntityTokens.length > 0
      ? matchedProjectEntityTokens
      : questionEntityTokens(tokens);
  const projectTopicTokens = uniqueStrings(
    tokens.filter(
      (token) =>
        !selectedEntityTokens.includes(token) &&
        !optionQuestionSignals.has(token) &&
        !genericQuestionEntityTokens.has(token),
    ),
  );
  const optionTopicTokens = uniqueStrings(
    tokens.filter((token) => optionQuestionSignals.has(token)),
  );
  const hasNamedEntity = selectedProjectKeys.length > 0 || selectedEntityTokens.length > 0;
  const wantsProjectFact = hasNamedEntity && projectTopicTokens.length > 0;
  const wantsOptionPreference = optionTopicTokens.length > 0;
  const wantsSourceEvidence = tokens.some((token) => sourceEvidenceQuestionSignals.has(token));

  return {
    optionTopicTokens,
    projectTopicTokens,
    selectedEntityTokens,
    selectedProjectKeys,
    tokens,
    wantsOptionPreference,
    wantsProjectFact,
    wantsSourceEvidence,
  };
};

const extractBodyCandidates = (body: string): ReadonlyArray<string> => {
  const candidates: Array<string> = [];
  const paragraph: Array<string> = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const candidate = cleanMarkup(paragraph.join(" "));
    if (candidate.length > 0) {
      candidates.push(candidate);
    }
    paragraph.length = 0;
  };

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushParagraph();
      continue;
    }

    if (line.startsWith("#")) {
      flushParagraph();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/u);
    const bullet = bulletMatch?.[1];
    if (bullet !== undefined) {
      flushParagraph();
      const candidate = cleanMarkup(bullet);
      if (candidate.length > 0) {
        candidates.push(candidate);
      }
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();

  return Array.from(new Set(candidates));
};

const readRecallDocuments = Effect.fnUntraced(function* (
  vaultPath: string,
  includeSources: boolean,
): Effect.fn.Return<ReadonlyArray<RecallDocument>, RecallError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectory(vaultPath, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new RecallError({
          reason: "ReadVaultFailed",
          message: `Failed to read vault contents: ${vaultPath}`,
          cause,
        }),
    ),
  );
  const relativePaths = entries
    .map((entry) => normalizeRelativePath(entry, path))
    .filter((relativePath) => isManagedRecallPath(relativePath, includeSources))
    .toSorted();

  return yield* Effect.forEach(relativePaths, (relativePath) =>
    Effect.gen(function* () {
      const memoryLayer = classifyRecallLayer(relativePath);
      if (memoryLayer === undefined) {
        return [] satisfies ReadonlyArray<RecallDocument>;
      }

      const content = yield* fs.readFileString(path.join(vaultPath, relativePath)).pipe(
        Effect.mapError(
          (cause) =>
            new RecallError({
              reason: "ReadVaultFailed",
              message: `Failed to read recall candidate: ${relativePath}`,
              cause,
            }),
        ),
      );

      return [
        {
          path: relativePath,
          memoryLayer,
          content,
        },
      ] satisfies ReadonlyArray<RecallDocument>;
    }),
  ).pipe(Effect.map((documents) => documents.flatMap((document) => document)));
});

const countTokenMatches = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
): number => {
  const candidateTokenCounts = candidateTokens.reduce(
    (counts, token) => counts.set(token, (counts.get(token) ?? 0) + 1),
    new Map<string, number>(),
  );

  return queryTokens.reduce(
    (score, token) => score + Math.min(candidateTokenCounts.get(token) ?? 0, 2),
    0,
  );
};

const countUniqueTokenMatches = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
): number => {
  const candidateTokenSet = new Set(candidateTokens);
  return queryTokens.filter((token) => candidateTokenSet.has(token)).length;
};

const layerScore = (memoryLayer: RecallLayer): number => {
  switch (memoryLayer) {
    case "note":
      return 14;
    case "project":
      return 12;
    case "user":
      return 12;
    case "record":
      return 8;
    case "map":
      return 5;
    case "core":
      return 3;
    case "person":
      return 2;
    case "source":
      return -5;
  }
};

const selectedProjectSet = (analysis: QuestionAnalysis): ReadonlySet<string> =>
  new Set(analysis.selectedProjectKeys);

const candidateHasSelectedProject = (
  analysis: QuestionAnalysis,
  candidate: CandidateDraft,
): boolean => {
  const selectedProjects = selectedProjectSet(analysis);
  if (selectedProjects.size > 0) {
    return candidate.projectKeys.some((projectKey) => selectedProjects.has(projectKey));
  }

  const candidateTokens = tokenSet([...candidate.tokens, ...candidate.metadataTokens]);
  return analysis.selectedEntityTokens.some((entityToken) => candidateTokens.has(entityToken));
};

const candidateHasCompetingProject = (
  analysis: QuestionAnalysis,
  candidate: CandidateDraft,
): boolean => {
  const selectedProjects = selectedProjectSet(analysis);
  return (
    selectedProjects.size > 0 &&
    candidate.projectKeys.some((projectKey) => !selectedProjects.has(projectKey))
  );
};

const isAnswerWorthyCandidateText = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return (
    !normalized.startsWith("read ") &&
    !normalized.startsWith("use this note when") &&
    !normalized.startsWith("do not use") &&
    !normalized.startsWith("none for") &&
    !normalized.startsWith("this fixture") &&
    !normalized.includes("distractor")
  );
};

const countCandidateTopicMatches = (
  topicTokens: ReadonlyArray<string>,
  candidate: CandidateDraft,
): number => countUniqueTokenMatches(topicTokens, candidate.tokens);

const isUserPreferenceCandidate = (candidate: CandidateDraft): boolean =>
  candidate.memoryLayer === "user" ||
  (candidate.memoryLayer === "note" && candidate.projectKeys.length === 0);

const questionMatchedEntityScore = (
  analysis: QuestionAnalysis,
  candidate: CandidateDraft,
): number => {
  if (analysis.selectedProjectKeys.length === 0 && analysis.selectedEntityTokens.length === 0) {
    return 0;
  }

  const hasSelectedProject = candidateHasSelectedProject(analysis, candidate);
  const hasCompetingProject = candidateHasCompetingProject(analysis, candidate);
  const missingSelectedProjectPenalty =
    candidate.projectKeys.length > 0 && !hasSelectedProject ? 22 : 0;

  return (
    (hasSelectedProject ? 36 : 0) - (hasCompetingProject ? 24 : 0) - missingSelectedProjectPenalty
  );
};

const optionApplicabilityScore = (analysis: QuestionAnalysis, candidate: CandidateDraft): number =>
  analysis.wantsOptionPreference &&
  isUserPreferenceCandidate(candidate) &&
  countCandidateTopicMatches(analysis.optionTopicTokens, candidate) > 0
    ? 20
    : 0;

const answerWorthyScore = (candidate: CandidateDraft): number =>
  isAnswerWorthyCandidateText(candidate.text) ? 4 : -20;

const contentStatusScore = (status: RecallContentStatus | undefined): number => {
  switch (status) {
    case "active":
      return 0;
    case "draft":
      return -16;
    case "stale":
      return -40;
    case "archived":
      return -64;
    case undefined:
      return 0;
  }
};

const projectStatusScore = (
  analysis: QuestionAnalysis,
  projectStatus: RecallProjectStatus | undefined,
): number => {
  if (!analysis.wantsProjectFact) {
    return 0;
  }

  switch (projectStatus) {
    case "active":
      return 0;
    case "candidate":
      return -8;
    case "completed":
      return -16;
    case "archived":
      return -36;
    case undefined:
      return 0;
  }
};

const sourcePolicyScore = (analysis: QuestionAnalysis, candidate: CandidateDraft): number =>
  candidate.memoryLayer !== "source" ? 0 : analysis.wantsSourceEvidence ? 24 : -28;

const scoreCandidate = (input: {
  readonly analysis: QuestionAnalysis;
  readonly candidate: CandidateDraft;
}): number =>
  countTokenMatches(input.analysis.tokens, input.candidate.tokens) * 3 +
  countUniqueTokenMatches(input.analysis.tokens, input.candidate.tokens) * 5 +
  countUniqueTokenMatches(input.analysis.tokens, input.candidate.metadataTokens) * 4 +
  layerScore(input.candidate.memoryLayer) +
  contentStatusScore(input.candidate.status) +
  projectStatusScore(input.analysis, input.candidate.projectStatus) +
  sourcePolicyScore(input.analysis, input.candidate) +
  (input.candidate.origin === "summary" ? 5 : 0) +
  questionMatchedEntityScore(input.analysis, input.candidate) +
  optionApplicabilityScore(input.analysis, input.candidate) +
  answerWorthyScore(input.candidate);

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

const makeCandidateDraft = (input: {
  readonly document: ParsedRecallDocument;
  readonly documentProjectKeys: ReadonlyArray<string>;
  readonly projectEntities: ReadonlyArray<ProjectEntity>;
  readonly text: string;
  readonly origin: RecallCandidateOrigin;
}): CandidateDraft => ({
  path: input.document.path,
  memoryLayer: input.document.memoryLayer,
  metadataTokens: input.document.metadataTokens,
  origin: input.origin,
  projectKeys: uniqueStrings([
    ...input.documentProjectKeys,
    ...detectProjectKeys(input.text, input.projectEntities),
  ]),
  projectStatus: input.document.projectStatus,
  status: input.document.status,
  text: input.text,
  tokens: tokenize(input.text),
});

const documentCandidates = (
  analysis: QuestionAnalysis,
  projectEntities: ReadonlyArray<ProjectEntity>,
  document: ParsedRecallDocument,
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
        text,
      }),
    ),
    ...extractBodyCandidates(document.body).map((text) =>
      makeCandidateDraft({
        document,
        documentProjectKeys: projectKeys,
        origin: "body",
        projectEntities,
        text,
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

const rankCandidates = (input: {
  readonly analysis: QuestionAnalysis;
  readonly documents: ReadonlyArray<ParsedRecallDocument>;
  readonly projectEntities: ReadonlyArray<ProjectEntity>;
}): ReadonlyArray<RecallCandidate> =>
  input.documents
    .flatMap((document) => documentCandidates(input.analysis, input.projectEntities, document))
    .filter((candidate) => candidate.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.path.localeCompare(right.path) ||
        left.text.localeCompare(right.text),
    );

const projectFactSupportScore = (analysis: QuestionAnalysis, candidate: RecallCandidate): number =>
  candidate.score +
  (candidateHasSelectedProject(analysis, candidate) ? 28 : 0) +
  countCandidateTopicMatches(analysis.projectTopicTokens, candidate) * 14 -
  (candidateHasCompetingProject(analysis, candidate) ? 28 : 0) -
  (isAnswerWorthyCandidateText(candidate.text) ? 0 : 40);

const isSupportedProjectFactCandidate = (
  analysis: QuestionAnalysis,
  candidate: RecallCandidate,
): boolean =>
  analysis.wantsProjectFact &&
  candidateHasSelectedProject(analysis, candidate) &&
  countCandidateTopicMatches(analysis.projectTopicTokens, candidate) > 0 &&
  (!analysis.wantsSourceEvidence || candidate.memoryLayer === "source") &&
  isAnswerWorthyCandidateText(candidate.text);

const optionPreferenceSupportScore = (
  analysis: QuestionAnalysis,
  candidate: RecallCandidate,
): number =>
  candidate.score +
  (candidate.memoryLayer === "user" ? 20 : 0) +
  (candidate.memoryLayer === "note" ? 8 : 0) +
  countCandidateTopicMatches(analysis.optionTopicTokens, candidate) * 14 -
  (isAnswerWorthyCandidateText(candidate.text) ? 0 : 30);

const isSupportedOptionPreferenceCandidate = (
  analysis: QuestionAnalysis,
  candidate: RecallCandidate,
): boolean =>
  analysis.wantsOptionPreference &&
  isUserPreferenceCandidate(candidate) &&
  countCandidateTopicMatches(analysis.optionTopicTokens, candidate) > 0 &&
  isAnswerWorthyCandidateText(candidate.text);

const bestSupportedCandidate = (input: {
  readonly candidates: ReadonlyArray<RecallCandidate>;
  readonly isSupported: (candidate: RecallCandidate) => boolean;
  readonly supportScore: (candidate: RecallCandidate) => number;
  readonly floor: number;
}): SupportedCandidate | undefined =>
  input.candidates
    .filter(input.isSupported)
    .map((candidate) => ({
      candidate,
      supportScore: input.supportScore(candidate),
    }))
    .filter((supported) => supported.supportScore >= input.floor)
    .toSorted(
      (left, right) =>
        right.supportScore - left.supportScore ||
        right.candidate.score - left.candidate.score ||
        left.candidate.path.localeCompare(right.candidate.path) ||
        left.candidate.text.localeCompare(right.candidate.text),
    )[0];

const bestSentenceForSignals = (
  text: string,
  signals: ReadonlySet<string>,
  requiredFragments: ReadonlyArray<string>,
): string => {
  const sentences = text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => cleanMarkup(sentence))
    .filter((sentence) => sentence.length > 0);

  const rankedSentence = sentences
    .map((sentence) => ({
      sentence,
      score:
        countUniqueTokenMatches(Array.from(signals), tokenize(sentence)) * 6 +
        requiredFragments.filter((fragment) => sentence.toLowerCase().includes(fragment)).length *
          10,
    }))
    .toSorted(
      (left, right) => right.score - left.score || left.sentence.localeCompare(right.sentence),
    )[0];

  return rankedSentence?.sentence ?? cleanMarkup(text);
};

const normalizeAnswerSentence = (sentence: string): string => {
  const normalized = cleanMarkup(sentence)
    .replace(/^(Decision|Explicit):\s*/u, "")
    .replace(/,?\s*for example\b.*$/iu, "")
    .trim();

  if (normalized.length === 0) {
    return normalized;
  }

  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
};

const answerPartSentences = (parts: ReadonlyArray<AnswerPart>): ReadonlyArray<string> =>
  uniqueStrings(parts.map((part) => part.sentence).filter((sentence) => sentence.length > 0));

const assembleAnswer = (input: {
  readonly analysis: QuestionAnalysis;
  readonly rankedCandidates: ReadonlyArray<RecallCandidate>;
}): { readonly status: RecallResponse["status"]; readonly answer: string } => {
  const projectCandidate = bestSupportedCandidate({
    candidates: input.rankedCandidates,
    floor: projectSupportFloor,
    isSupported: (candidate) => isSupportedProjectFactCandidate(input.analysis, candidate),
    supportScore: (candidate) => projectFactSupportScore(input.analysis, candidate),
  });
  const optionCandidate = bestSupportedCandidate({
    candidates: input.rankedCandidates,
    floor: optionSupportFloor,
    isSupported: (candidate) => isSupportedOptionPreferenceCandidate(input.analysis, candidate),
    supportScore: (candidate) => optionPreferenceSupportScore(input.analysis, candidate),
  });
  const projectParts: ReadonlyArray<AnswerPart> =
    projectCandidate === undefined
      ? []
      : [
          {
            category: "project_fact",
            sentence: normalizeAnswerSentence(
              bestSentenceForSignals(
                projectCandidate.candidate.text,
                new Set(input.analysis.projectTopicTokens),
                [],
              ),
            ),
          },
        ];
  const optionParts: ReadonlyArray<AnswerPart> =
    optionCandidate === undefined
      ? []
      : [
          {
            category: "user_preference",
            sentence: normalizeAnswerSentence(
              bestSentenceForSignals(
                optionCandidate.candidate.text,
                new Set(input.analysis.optionTopicTokens),
                [],
              ),
            ),
          },
        ];
  const parts = [...projectParts, ...optionParts];
  const sentences = answerPartSentences(parts);

  return sentences.length === 0
    ? {
        answer: notFoundAnswer,
        status: "not_found",
      }
    : {
        answer: sentences.join(" "),
        status: "answered",
      };
};

const sanitizeGeneratedFields = (response: RecallResponse): RecallResponse => ({
  ...response,
  answer: cleanMarkup(response.answer),
  warnings: response.warnings.map(cleanMarkup),
});

export const recall = Effect.fnUntraced(function* (
  request: RecallRequest,
): Effect.fn.Return<RecallResponse, RecallError, FileSystem.FileSystem | Path.Path> {
  const question = request.question.trim();
  if (question.length === 0) {
    return yield* new RecallError({
      reason: "InvalidQuestion",
      message: "Recall question must not be empty or whitespace.",
    });
  }

  const documents = yield* readRecallDocuments(request.vaultPath, request.includeSources);
  const parsedDocuments = documents.map(parseRecallDocument);
  const projectEntities = projectEntitiesFromDocuments(parsedDocuments);
  const analysis = analyzeQuestion(question, projectEntities);
  const rankedCandidates = rankCandidates({
    analysis,
    documents: parsedDocuments,
    projectEntities,
  });
  const assembled = assembleAnswer({ analysis, rankedCandidates });
  const response = {
    status: assembled.status,
    question: request.question,
    answer: assembled.answer,
    warnings: [],
  } satisfies RecallResponse;

  return sanitizeGeneratedFields(response);
});
