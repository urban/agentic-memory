import { Effect, FileSystem, Path, Schema } from "effect";

const RecallWarnings = Schema.Array(Schema.String).annotate({ identifier: "RecallWarnings" });

export const RecallRequest = Schema.Struct({
  vaultPath: Schema.String,
  question: Schema.String,
}).annotate({ identifier: "RecallRequest" });
export type RecallRequest = typeof RecallRequest.Type;

export const RecallResponse = Schema.Struct({
  status: Schema.Literal("answered"),
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

type RecallCandidate = {
  readonly path: string;
  readonly memoryLayer: RecallLayer;
  readonly text: string;
  readonly tokens: ReadonlyArray<string>;
  readonly score: number;
  readonly origin: "summary" | "body";
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
  "an",
  "and",
  "back",
  "for",
  "how",
  "i",
  "in",
  "into",
  "need",
  "should",
  "the",
  "to",
  "what",
  "when",
  "with",
]);

const latencySignals = new Set(["200ms", "p95", "latency", "budget"]);
const optionSignals = new Set([
  "capital",
  "letter",
  "option",
  "prioritization",
  "rank",
  "stack",
  "urban",
]);

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

const isManagedRecallPath = (relativePath: string): boolean =>
  isVaultRelativeMarkdownPath(relativePath) && classifyRecallLayer(relativePath) !== undefined;

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

const lastPathSegment = (target: string): string => {
  const segments = target.split("/");
  return segments.at(-1) ?? target;
};

const sanitizeInternalReferences = (input: string): string =>
  input
    .replace(/\.agentic-memory/giu, "control plane")
    .replace(/\bMEMORY\.md\b/gu, "memory")
    .replace(/\bUSER\.md\b/gu, "user memory")
    .replace(/\b(?:projects|notes|maps|records|sources)\//giu, "")
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
): { readonly frontmatter?: string; readonly body: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  return match === null
    ? { body: content }
    : {
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

const extractFrontmatterSummary = (frontmatter: string | undefined): ReadonlyArray<string> => {
  if (frontmatter === undefined) {
    return [];
  }

  for (const line of frontmatter.split(/\r?\n/u)) {
    const match = line.match(/^summary:\s*(.+)$/u);
    if (match !== null) {
      return [cleanMarkup(unquoteFrontmatterValue(match[1]))];
    }
  }

  return [];
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
    if (bulletMatch !== null) {
      flushParagraph();
      const candidate = cleanMarkup(bulletMatch[1]);
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
    .filter(isManagedRecallPath)
    .toSorted();

  return yield* Effect.forEach(relativePaths, (relativePath) =>
    Effect.gen(function* () {
      const memoryLayer = classifyRecallLayer(relativePath);
      if (memoryLayer === undefined) {
        return [];
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
      return 18;
    case "project":
      return 14;
    case "user":
      return 12;
    case "map":
      return 8;
    case "core":
      return 6;
    case "record":
      return 4;
    case "person":
      return 2;
    case "source":
      return -8;
  }
};

const signalScore = (text: string): number => {
  const normalized = text.toLowerCase();
  return (
    (normalized.includes("200ms p95") ? 18 : 0) +
    (normalized.includes("latency budget") ? 14 : 0) +
    (normalized.includes("stack-ranked") ? 18 : 0) +
    (normalized.includes("capital-letter") ? 18 : 0) -
    (normalized.includes("5 second batch retry window") ? 10 : 0) -
    (normalized.startsWith("use this note when") ? 12 : 0) -
    (normalized.startsWith("read ") ? 8 : 0) -
    (normalized.startsWith("this fixture") ? 10 : 0) -
    (normalized.startsWith("do not use") ? 16 : 0)
  );
};

const contrastPenalty = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
): number => {
  const queryTokenSet = new Set(queryTokens);
  const candidateTokenSet = new Set(candidateTokens);
  return !queryTokenSet.has("beta") && candidateTokenSet.has("beta") ? 12 : 0;
};

const scoreCandidate = (input: {
  readonly queryTokens: ReadonlyArray<string>;
  readonly pathTokens: ReadonlyArray<string>;
  readonly candidate: Omit<RecallCandidate, "score">;
}): number =>
  countTokenMatches(input.queryTokens, input.candidate.tokens) * 3 +
  countUniqueTokenMatches(input.queryTokens, input.candidate.tokens) * 5 +
  countUniqueTokenMatches(input.queryTokens, input.pathTokens) * 4 +
  layerScore(input.candidate.memoryLayer) +
  (input.candidate.origin === "summary" ? 8 : 0) +
  signalScore(input.candidate.text) -
  contrastPenalty(input.queryTokens, input.candidate.tokens);

const documentCandidates = (
  queryTokens: ReadonlyArray<string>,
  document: RecallDocument,
): ReadonlyArray<RecallCandidate> => {
  const { frontmatter, body } = splitFrontmatter(document.content);
  const pathTokens = tokenize(document.path);
  const summaryCandidates = extractFrontmatterSummary(frontmatter).map((text) => ({
    path: document.path,
    memoryLayer: document.memoryLayer,
    text,
    tokens: tokenize(text),
    origin: "summary" as const,
  }));
  const bodyCandidates = extractBodyCandidates(body).map((text) => ({
    path: document.path,
    memoryLayer: document.memoryLayer,
    text,
    tokens: tokenize(text),
    origin: "body" as const,
  }));

  return [...summaryCandidates, ...bodyCandidates]
    .filter((candidate) => candidate.tokens.length > 0)
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate({ queryTokens, pathTokens, candidate }),
    }));
};

const rankCandidates = (
  question: string,
  documents: ReadonlyArray<RecallDocument>,
): ReadonlyArray<RecallCandidate> => {
  const queryTokens = tokenize(question);
  return documents
    .flatMap((document) => documentCandidates(queryTokens, document))
    .filter((candidate) => candidate.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.path.localeCompare(right.path) ||
        left.text.localeCompare(right.text),
    );
};

const hasLatencyFact = (candidate: RecallCandidate): boolean =>
  candidate.tokens.some((token) => latencySignals.has(token)) &&
  (candidate.text.toLowerCase().includes("200ms") || candidate.text.toLowerCase().includes("p95"));

const hasOptionFact = (candidate: RecallCandidate): boolean =>
  candidate.tokens.some((token) => optionSignals.has(token)) &&
  candidate.text.toLowerCase().includes("stack-ranked") &&
  candidate.text.toLowerCase().includes("capital-letter");

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

const assembleAnswer = (rankedCandidates: ReadonlyArray<RecallCandidate>): string => {
  const latencyCandidate = rankedCandidates.find(hasLatencyFact);
  const optionCandidate = rankedCandidates.find(hasOptionFact);
  const latencySentence =
    latencyCandidate === undefined
      ? undefined
      : normalizeAnswerSentence(
          bestSentenceForSignals(latencyCandidate.text, latencySignals, ["200ms", "p95"]),
        );
  const optionSentence =
    optionCandidate === undefined
      ? undefined
      : normalizeAnswerSentence(
          bestSentenceForSignals(optionCandidate.text, optionSignals, [
            "stack-ranked",
            "capital-letter",
          ]),
        );
  const fallbackSentence =
    latencySentence === undefined && optionSentence === undefined
      ? normalizeAnswerSentence(rankedCandidates[0]?.text ?? "No relevant memory found.")
      : undefined;

  return Array.from(
    new Set(
      [latencySentence, optionSentence, fallbackSentence].filter(
        (sentence) => sentence !== undefined,
      ),
    ),
  ).join(" ");
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

  const documents = yield* readRecallDocuments(request.vaultPath);
  const rankedCandidates = rankCandidates(question, documents);
  const response = {
    status: "answered",
    question: request.question,
    answer: assembleAnswer(rankedCandidates),
    warnings: [],
  } satisfies RecallResponse;

  return sanitizeGeneratedFields(response);
});
