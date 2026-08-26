export type RecallEvidenceCandidate = {
  readonly documentPath: string;
  readonly text: string;
};

export type RecallEvidencePassage = {
  readonly id: string;
  readonly text: string;
};

export type RecallEvidencePacket = {
  readonly passages: ReadonlyArray<RecallEvidencePassage>;
};

const MAX_EVIDENCE_PASSAGES = 5;
const MAX_EVIDENCE_DOCUMENTS = 5;
const MAX_PASSAGES_PER_DOCUMENT = 2;
const MAX_EVIDENCE_TOKENS = 4_500;
const MIN_OVERLAP_CHARACTERS = 24;
const MIN_OVERLAP_WORDS = 4;

const normalizeWhitespace = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();
const approximateTokens = (text: string): number => Math.ceil(text.length / 4);

const deduplicatePassageUnits = (text: string): string => {
  const units = text
    .split(/(?<=[.!?])(?:[ \t]+|\r?\n+)|\r?\n+/u)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
  const seen = new Set<string>();
  const unique = units.filter((unit) => {
    const normalized = normalizeWhitespace(unit);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
  return unique.length === units.length ? text : unique.join("\n");
};

const isMeaningfulOverlap = (text: string): boolean =>
  text.length >= MIN_OVERLAP_CHARACTERS && text.split(/\s+/u).length >= MIN_OVERLAP_WORDS;

const boundaryOverlapLength = (left: string, right: string): number => {
  const maximumLength = Math.min(left.length, right.length);
  for (let length = maximumLength; length >= MIN_OVERLAP_CHARACTERS; length -= 1) {
    const overlap = right.slice(0, length);
    if (left.endsWith(overlap) && isMeaningfulOverlap(overlap)) {
      return length;
    }
  }
  return 0;
};

const removeSelectedOverlap = (
  text: string,
  selected: ReadonlyArray<RecallEvidencePassage>,
): string | undefined => {
  let remaining = text.trim();
  for (const passage of selected) {
    const existing = normalizeWhitespace(passage.text);
    const normalizedRemaining = normalizeWhitespace(remaining);
    if (existing.includes(normalizedRemaining)) {
      return undefined;
    }
    if (isMeaningfulOverlap(existing) && normalizedRemaining.includes(existing)) {
      remaining = normalizeWhitespace(normalizedRemaining.replace(existing, " "));
      continue;
    }
    const prefixOverlap = boundaryOverlapLength(existing, normalizedRemaining);
    if (prefixOverlap > 0) {
      remaining = normalizeWhitespace(normalizedRemaining.slice(prefixOverlap));
      continue;
    }
    const suffixOverlap = boundaryOverlapLength(normalizedRemaining, existing);
    if (suffixOverlap > 0) {
      remaining = normalizeWhitespace(normalizedRemaining.slice(0, -suffixOverlap));
    }
  }
  return remaining.length === 0 ? undefined : remaining;
};

export const prepareRecallEvidencePacket = (
  candidates: ReadonlyArray<RecallEvidenceCandidate>,
): RecallEvidencePacket => {
  const selected: Array<RecallEvidencePassage> = [];
  const documents = new Set<string>();
  const documentPassageCounts = new Map<string, number>();
  let selectedTokens = 0;

  for (const candidate of candidates) {
    const documentPassageCount = documentPassageCounts.get(candidate.documentPath) ?? 0;
    const deduplicatedText = removeSelectedOverlap(
      deduplicatePassageUnits(candidate.text),
      selected,
    );
    const candidateTokens =
      deduplicatedText === undefined ? 0 : approximateTokens(deduplicatedText);
    if (
      selected.length >= MAX_EVIDENCE_PASSAGES ||
      documentPassageCount >= MAX_PASSAGES_PER_DOCUMENT ||
      deduplicatedText === undefined ||
      selectedTokens + candidateTokens > MAX_EVIDENCE_TOKENS ||
      (!documents.has(candidate.documentPath) && documents.size >= MAX_EVIDENCE_DOCUMENTS)
    ) {
      continue;
    }
    documents.add(candidate.documentPath);
    documentPassageCounts.set(candidate.documentPath, documentPassageCount + 1);
    selectedTokens += candidateTokens;
    selected.push({ id: `E${selected.length + 1}`, text: deduplicatedText });
  }

  return { passages: selected };
};
