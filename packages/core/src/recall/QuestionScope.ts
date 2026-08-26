const requestPreamble = "(?:(?:can|could|would|will)\\s+you\\s+)?(?:also\\s*,?\\s+|please\\s+)?";

const imperativeRequestVerb =
  "(?:tell|explain|describe|list|show|identify|summarize|give|provide|include)\\b";

const requestClauseBeginning = `${requestPreamble}(?:(?:what|why|how|who|where|when|which)\\b|${imperativeRequestVerb})`;

const requestClauseStart = new RegExp(`^${requestClauseBeginning}`, "i");

const requestClauseAt = new RegExp(requestClauseBeginning, "iy");

const imperativeRequestStart = new RegExp(`^${requestPreamble}${imperativeRequestVerb}`, "i");

const additiveMarker = /\b(?:as\s+well\s+as|plus|and\s+then)\b/gi;

const inlineAlsoRequestClause = /\balso\s+tell\s+me\b/gi;

const namedPhrasePrefix = /(?:word|phrase|term|expression)\s+(?:["'“‘]\s*)?$/i;

const namedSubjectWords = ["word", "phrase", "term", "expression"];

const openingQuotes = new Set(['"', "'", "“", "‘"]);

const whitespaceCharacter = /\s/u;

const wordCharacter = /\w/u;

const coordinatedRequestClause = new RegExp(
  `(?:,\\s*(?:and\\s+)?|\\band\\s+)${requestClauseBeginning}`,
  "gi",
);

const namedSubjectPrefix = /(?:word|phrase|term|expression)\s+(?:["'“‘]\s*)?[^,;.!?\n]*$/i;

const namedSubjectPredicate =
  /^\s*(?:["'”’]\s*)?(?:mean|means|meant|refer|refers|signify|signifies)\b/i;

const isNamedCoordinatedSubject = (question: string, clause: RegExpMatchArray): boolean => {
  const clauseIndex = clause.index ?? 0;
  return (
    namedSubjectPrefix.test(question.slice(0, clauseIndex)) &&
    namedSubjectPredicate.test(question.slice(clauseIndex + clause[0].length))
  );
};

const hasCoordinatedRequestClause = (question: string): boolean =>
  requestClauseStart.test(question) &&
  Array.from(question.matchAll(coordinatedRequestClause)).some(
    (clause) => !isNamedCoordinatedSubject(question, clause),
  );

const hasMultipleRequestClauses = (question: string, separator: RegExp): boolean =>
  question
    .split(separator)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && requestClauseStart.test(clause)).length > 1;

const hasInlineAlsoRequestClause = (question: string): boolean =>
  Array.from(question.matchAll(inlineAlsoRequestClause)).some(({ index }) => {
    const prefix = question.slice(0, index);
    return (
      !namedPhrasePrefix.test(prefix) &&
      (imperativeRequestStart.test(question) || /(?:\band|[,;])\s*$/i.test(prefix))
    );
  });

const skipWhitespaceForward = (question: string, start: number): number => {
  let cursor = start;
  while (cursor < question.length && whitespaceCharacter.test(question[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
};

const skipWhitespaceBackward = (question: string, end: number): number => {
  let cursor = end;
  while (cursor > 0 && whitespaceCharacter.test(question[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  return cursor;
};

const hasNamedSubjectPrefix = (
  question: string,
  normalizedQuestion: string,
  markerIndex: number,
): boolean => {
  const beforeMarker = skipWhitespaceBackward(question, markerIndex);
  const quote = question[beforeMarker - 1];
  const subjectEnd =
    quote !== undefined && openingQuotes.has(quote)
      ? skipWhitespaceBackward(question, beforeMarker - 1)
      : beforeMarker;
  const separatorEnd =
    quote !== undefined && openingQuotes.has(quote) ? beforeMarker - 1 : markerIndex;
  return (
    subjectEnd < separatorEnd &&
    namedSubjectWords.some((word) => normalizedQuestion.endsWith(word, subjectEnd))
  );
};

const hasPlusOperatorSuffix = (
  question: string,
  normalizedQuestion: string,
  markerIndex: number,
  markerLength: number,
): boolean => {
  if (!normalizedQuestion.startsWith("plus", markerIndex)) {
    return false;
  }
  const markerEnd = markerIndex + markerLength;
  const operatorStart = skipWhitespaceForward(question, markerEnd);
  const operatorEnd = operatorStart + "operator".length;
  return (
    operatorStart > markerEnd &&
    normalizedQuestion.startsWith("operator", operatorStart) &&
    !wordCharacter.test(question[operatorEnd] ?? "")
  );
};

const isNamedAdditiveMarker = (
  question: string,
  normalizedQuestion: string,
  marker: RegExpMatchArray,
): boolean => {
  const markerIndex = marker.index ?? 0;
  return (
    hasNamedSubjectPrefix(question, normalizedQuestion, markerIndex) ||
    hasPlusOperatorSuffix(question, normalizedQuestion, markerIndex, marker[0].length)
  );
};

const startsRequestClauseAt = (question: string, index: number): boolean => {
  requestClauseAt.lastIndex = index;
  return requestClauseAt.test(question);
};

const skipAdditiveSeparator = (question: string, start: number): number => {
  const afterLeadingWhitespace = skipWhitespaceForward(question, start);
  const afterComma =
    question[afterLeadingWhitespace] === "," ? afterLeadingWhitespace + 1 : afterLeadingWhitespace;
  return skipWhitespaceForward(question, afterComma);
};

const hasAdditiveRequestClause = (question: string): boolean => {
  const normalizedQuestion = question.toLowerCase();
  for (const marker of question.matchAll(additiveMarker)) {
    const markerIndex = marker.index ?? 0;
    const clauseStart = skipAdditiveSeparator(question, markerIndex + marker[0].length);
    if (
      !isNamedAdditiveMarker(question, normalizedQuestion, marker) &&
      startsRequestClauseAt(question, clauseStart)
    ) {
      return true;
    }
  }
  return false;
};

const hasEllipticalAdditiveRequest = (question: string): boolean => {
  if (!imperativeRequestStart.test(question)) {
    return false;
  }
  const normalizedQuestion = question.toLowerCase();
  for (const marker of question.matchAll(additiveMarker)) {
    if (!isNamedAdditiveMarker(question, normalizedQuestion, marker)) {
      return true;
    }
  }
  return false;
};

/**
 * Detects only the documented, high-confidence multipart shapes: multiple question marks,
 * sentence/newline/semicolon-separated request clauses, repeated interrogative clauses,
 * and explicit additive request markers. It intentionally does not attempt full natural-language parsing.
 */
export const isUnsupportedMultipartQuestion = (question: string): boolean =>
  (question.match(/\?/g)?.length ?? 0) > 1 ||
  hasMultipleRequestClauses(question, /[.!?]+/) ||
  hasMultipleRequestClauses(question, /\r?\n+/) ||
  hasMultipleRequestClauses(question, /;+/) ||
  hasCoordinatedRequestClause(question) ||
  hasAdditiveRequestClause(question) ||
  hasEllipticalAdditiveRequest(question) ||
  hasInlineAlsoRequestClause(question);
