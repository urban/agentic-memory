import { createHash } from "node:crypto";
import { Schema } from "effect";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_SHA256,
} from "./EmbeddingModel.ts";

type ParsedManagedMemoryDocument = import("../vault/ManagedMemory.ts").ParsedManagedMemoryDocument;

export const EMBEDDING_PROMPT_VERSION = "embeddinggemma-document-v1";
export const SEMANTIC_INDEX_SCHEMA_VERSION = "semantic-index-schema-v1";
export const CHUNKING_VERSION = "markdown-heading-paragraph-v8";
export const CHUNK_TARGET_TOKENS = 900;
export const CHUNK_OVERLAP_PERCENT = 15;
export const EMBEDDING_NORMALIZATION = "node-llama-cpp-embedding-context-default";

export const SemanticChunk = Schema.Struct({
  ordinal: Schema.Int,
  headingPath: Schema.Array(Schema.String),
  startLine: Schema.Int,
  endLine: Schema.Int,
  text: Schema.String,
  textHash: Schema.String,
  embeddingInput: Schema.String,
}).annotate({ identifier: "SemanticChunk" });
export type SemanticChunk = typeof SemanticChunk.Type;

type SourceUnit = {
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly wordLines: ReadonlyArray<number>;
};

type Section = {
  readonly headingPath: ReadonlyArray<string>;
  readonly units: ReadonlyArray<SourceUnit>;
};

type FenceDelimiter = {
  readonly marker: "`" | "~";
  readonly length: number;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const approximateTokens = (text: string): number => Math.ceil(text.length / 4);

const openingFenceDelimiter = (line: string): FenceDelimiter | undefined => {
  const match = line.match(/^[ ]{0,3}(`{3,}|~{3,})/u);
  const sequence = match?.[1];
  const matchedPrefix = match?.[0];
  if (sequence === undefined || matchedPrefix === undefined) {
    return undefined;
  }
  const marker = sequence[0];
  if (marker !== "`" && marker !== "~") {
    return undefined;
  }
  if (marker === "`" && line.slice(matchedPrefix.length).includes("`")) {
    return undefined;
  }
  return { marker, length: sequence.length };
};

const closesFence = (line: string, activeFence: FenceDelimiter): boolean => {
  const match = line.match(/^[ ]{0,3}(`+|~+)[\t ]*$/u);
  const sequence = match?.[1];
  return (
    sequence !== undefined &&
    sequence[0] === activeFence.marker &&
    sequence.length >= activeFence.length
  );
};

const atxHeading = (
  line: string,
): { readonly level: number; readonly content: string } | undefined => {
  const match = line.match(/^[ ]{0,3}(#{1,6})[\t ]+(.+?)[\t ]*$/u);
  const marker = match?.[1];
  const content = match?.[2];
  if (marker === undefined || content === undefined) {
    return undefined;
  }
  return {
    level: marker.length,
    content: content.replace(/[\t ]+#+[\t ]*$/u, "").trim(),
  };
};

export const formatDocumentEmbeddingInput = (
  title: string,
  headingPath: ReadonlyArray<string>,
  text: string,
): string =>
  `title: ${title} | text: ${headingPath.length === 0 ? "(document)" : headingPath.join(" > ")}\n${text}`;

const parseSections = (document: ParsedManagedMemoryDocument): ReadonlyArray<Section> => {
  const sections: Array<Section> = [];
  const headings: Array<string> = [];
  let units: Array<SourceUnit> = [];
  let paragraph: Array<{ readonly text: string; readonly line: number }> = [];
  let activeFence: FenceDelimiter | undefined;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    const wordLines = paragraph.flatMap(({ text, line }) =>
      text
        .split(/\s+/u)
        .filter((word) => word.length > 0)
        .map(() => line),
    );
    units.push({
      text: paragraph
        .map(({ text }) => text)
        .join("\n")
        .trim(),
      startLine: paragraph[0]?.line ?? document.bodyStartLine,
      endLine: paragraph.at(-1)?.line ?? document.bodyStartLine,
      wordLines,
    });
    paragraph = [];
  };
  const flushSection = (): void => {
    flushParagraph();
    const nonempty = units.filter((unit) => unit.text.length > 0);
    if (nonempty.length > 0) {
      sections.push({ headingPath: [...headings], units: nonempty });
    }
    units = [];
  };

  const lines = document.body.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const lineNumber = document.bodyStartLine + index;
    const openingFence = activeFence === undefined ? openingFenceDelimiter(line) : undefined;
    const closingFence = activeFence === undefined ? false : closesFence(line, activeFence);
    const heading =
      activeFence === undefined && openingFence === undefined ? atxHeading(line) : undefined;
    if (heading !== undefined) {
      flushSection();
      headings.splice(heading.level - 1);
      headings.push(heading.content);
      continue;
    }
    if (line.trim().length === 0 && activeFence === undefined) {
      flushParagraph();
    } else {
      paragraph.push({ text: line, line: lineNumber });
    }
    if (openingFence !== undefined) {
      activeFence = openingFence;
    } else if (closingFence) {
      activeFence = undefined;
    }
  }
  flushSection();
  return sections;
};

const sliceSourceUnit = (
  unit: SourceUnit,
  words: ReadonlyArray<string>,
  start: number,
  end: number,
): SourceUnit => {
  const wordLines = unit.wordLines.slice(start, end);
  return {
    text: words.slice(start, end).join(" "),
    startLine: wordLines[0] ?? unit.startLine,
    endLine: wordLines.at(-1) ?? unit.endLine,
    wordLines,
  };
};

const splitUnitAtTokenBudget = (
  unit: SourceUnit,
  preceding: ReadonlyArray<SourceUnit>,
  targetTokens: number,
  formatEmbeddingInput: (text: string) => string,
):
  | { readonly _tag: "none" }
  | { readonly _tag: "whole"; readonly unit: SourceUnit }
  | {
      readonly _tag: "irreducibleSplit";
      readonly prefix: SourceUnit;
      readonly remainder: SourceUnit;
    }
  | { readonly _tag: "irreducibleWhole"; readonly unit: SourceUnit }
  | { readonly _tag: "split"; readonly prefix: SourceUnit; readonly remainder: SourceUnit } => {
  const candidateText = (text: string): string =>
    [...preceding.map((sourceUnit) => sourceUnit.text), text].join("\n\n");
  if (approximateTokens(formatEmbeddingInput(candidateText(unit.text))) <= targetTokens) {
    return { _tag: "whole", unit };
  }
  const words = unit.text.split(/\s+/u).filter((word) => word.length > 0);
  let prefixLength = 0;
  for (let index = 1; index <= words.length; index += 1) {
    if (
      approximateTokens(formatEmbeddingInput(candidateText(words.slice(0, index).join(" ")))) >
      targetTokens
    ) {
      break;
    }
    prefixLength = index;
  }
  if (prefixLength === 0) {
    if (preceding.length > 0) {
      return { _tag: "none" };
    }
    const [firstWord] = words;
    if (firstWord === undefined) {
      return { _tag: "none" };
    }
    const prefix = sliceSourceUnit(unit, words, 0, 1);
    if (words.length === 1) {
      return { _tag: "irreducibleWhole", unit: prefix };
    }
    return {
      _tag: "irreducibleSplit",
      prefix,
      remainder: sliceSourceUnit(unit, words, 1, words.length),
    };
  }
  return {
    _tag: "split",
    prefix: sliceSourceUnit(unit, words, 0, prefixLength),
    remainder: sliceSourceUnit(unit, words, prefixLength, words.length),
  };
};

const overlappingSuffix = (
  units: ReadonlyArray<SourceUnit>,
  overlapTarget: number,
): ReadonlyArray<SourceUnit> => {
  let selected: Array<SourceUnit> = [];
  for (const unit of units.toReversed()) {
    const wholeCandidate = [unit, ...selected];
    if (approximateTokens(wholeCandidate.map(({ text }) => text).join("\n\n")) <= overlapTarget) {
      selected = wholeCandidate;
      continue;
    }
    const words = unit.text.split(/\s+/u).filter((word) => word.length > 0);
    let suffixStart = words.length;
    for (let index = words.length - 1; index >= 0; index -= 1) {
      const candidateUnit = sliceSourceUnit(unit, words, index, words.length);
      const candidate = [candidateUnit, ...selected];
      if (approximateTokens(candidate.map(({ text }) => text).join("\n\n")) > overlapTarget) {
        break;
      }
      suffixStart = index;
    }
    if (suffixStart < words.length) {
      selected = [sliceSourceUnit(unit, words, suffixStart, words.length), ...selected];
    }
    break;
  }
  return selected;
};

const sectionWindows = (
  section: Section,
  title: string,
  targetTokens: number,
  overlapPercent: number,
): ReadonlyArray<{
  readonly headingPath: ReadonlyArray<string>;
  readonly units: ReadonlyArray<SourceUnit>;
}> => {
  const windows: Array<{
    readonly headingPath: ReadonlyArray<string>;
    readonly units: ReadonlyArray<SourceUnit>;
  }> = [];
  let pending = [...section.units];
  let current: Array<SourceUnit> = [];
  let currentIsOverlap = false;
  const formatEmbeddingInput = (text: string): string =>
    formatDocumentEmbeddingInput(title, section.headingPath, text);
  const payloadCapacity = Math.max(targetTokens - approximateTokens(formatEmbeddingInput("")), 0);
  const overlapTarget = Math.ceil((payloadCapacity * overlapPercent) / 100);
  while (pending.length > 0) {
    const [unit, ...rest] = pending;
    if (unit === undefined) {
      break;
    }
    const fitted = splitUnitAtTokenBudget(unit, current, targetTokens, formatEmbeddingInput);
    if (fitted._tag === "whole") {
      current.push(fitted.unit);
      currentIsOverlap = false;
      pending = rest;
      continue;
    }
    if (fitted._tag === "split" || fitted._tag === "irreducibleSplit") {
      current.push(fitted.prefix);
      currentIsOverlap = false;
      pending = [fitted.remainder, ...rest];
    } else if (fitted._tag === "irreducibleWhole") {
      current.push(fitted.unit);
      currentIsOverlap = false;
      pending = rest;
      continue;
    } else if (current.length === 0) {
      current.push(unit);
      currentIsOverlap = false;
      pending = rest;
    } else if (currentIsOverlap) {
      current = [];
      currentIsOverlap = false;
      continue;
    }
    windows.push({ headingPath: section.headingPath, units: current });
    current = [...overlappingSuffix(current, overlapTarget)];
    currentIsOverlap = true;
  }
  if (current.length > 0) {
    windows.push({ headingPath: section.headingPath, units: current });
  }
  return windows;
};

export const formatQueryEmbeddingInput = (question: string): string =>
  `task: search result | query: ${question}`;

export const chunkManagedMemoryDocument = (
  document: ParsedManagedMemoryDocument,
  options: {
    readonly targetTokens?: number;
    readonly overlapPercent?: number;
  } = {},
): ReadonlyArray<SemanticChunk> => {
  const targetTokens = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlapPercent = options.overlapPercent ?? CHUNK_OVERLAP_PERCENT;
  return parseSections(document)
    .flatMap((section) => sectionWindows(section, document.title, targetTokens, overlapPercent))
    .map(({ headingPath, units }, ordinal) => {
      const text = units.map((unit) => unit.text).join("\n\n");
      return {
        ordinal,
        headingPath: [...headingPath],
        startLine: units[0]?.startLine ?? document.bodyStartLine,
        endLine: units.at(-1)?.endLine ?? document.bodyStartLine,
        text,
        textHash: sha256(text),
        embeddingInput: formatDocumentEmbeddingInput(document.title, headingPath, text),
      } satisfies SemanticChunk;
    });
};

export const fingerprintSemanticIndexCompatibility = (dimensions: number): string =>
  sha256(
    [
      SEMANTIC_INDEX_SCHEMA_VERSION,
      EMBEDDING_MODEL_ID,
      EMBEDDING_MODEL_SHA256,
      EMBEDDING_PROMPT_VERSION,
      CHUNKING_VERSION,
      String(CHUNK_TARGET_TOKENS),
      String(CHUNK_OVERLAP_PERCENT),
      EMBEDDING_NORMALIZATION,
      String(dimensions),
    ].join("\n"),
  );

export const SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT = fingerprintSemanticIndexCompatibility(
  EMBEDDING_MODEL_DIMENSIONS,
);
