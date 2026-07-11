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

export const tokenize = (input: string): ReadonlyArray<string> =>
  input
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !stopWords.has(token));

export const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from(new Set(values.filter((value) => value.length > 0)));

export const tokenSet = (tokens: ReadonlyArray<string>): ReadonlySet<string> => new Set(tokens);

export const lastPathSegment = (target: string): string => {
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

export const cleanMarkup = (input: string): string =>
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

export const normalizeForDeduplication = (input: string): string =>
  cleanMarkup(input).toLowerCase();

export const countTokenMatches = (
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

export const countUniqueTokenMatches = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
): number => {
  const candidateTokenSet = new Set(candidateTokens);
  return queryTokens.filter((token) => candidateTokenSet.has(token)).length;
};
