export type SafeRecallEvidence =
  | { readonly _tag: "ineligible" }
  | { readonly _tag: "eligible"; readonly text: string };

const markdownRoutePattern =
  /\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\[[^\]]*\]|^\s*\[[^\]]+\]:\s*\S+|\bread when\s*:|https?:\/\/\S+/iu;

const documentPathPattern =
  /(?:^|[\s("'`])(?:(?:[A-Z]:[\\/]|\.{0,2}[\\/])(?:[^\s/\\)"'`]+[\\/])*[^\s/\\)"'`]+|(?:[^\s/\\)"'`]+[\\/])+[^\s/\\)"'`]*\.[\p{L}\p{N}][\p{L}\p{N}_-]*|(?:MEMORY|USER|AGENTS)\.md\b)|\b(?:see|open|load|follow|visit|refer to|consult)\s+(?:the\s+)?(?:[^\s/\\)"'`]+[\\/])+[^\s/\\).,"'`]+/iu;

const contextualExtensionlessDocumentPathPattern =
  /\b(?:path|file|document|runbook)\b(?:\s+(?:(?:path|location)\s+)?(?:(?:is|was)\s+)?(?:(?:located|stored|found|available)\s+)?(?:at|in|under|is|:)|\s*:)\s+(?:the\s+)?`?(?:(?:[^\s/\\)"'`]+[\\/])+[^\s/\\).,"'`]+|[^\s/\\).,"'`]+\.[\p{L}\p{N}][\p{L}\p{N}_-]*)`?(?=\s*[.!?,;:]?\s*$)|^\s*deploy\s+using\s+(?:the\s+)?(?:[^\s/\\)"'`]+[\\/])+[^\s/\\).,"'`]+\s*[.!?]?\s*$/iu;

const delimitedColonDocumentPathPattern =
  /\b(?:path|file|document|runbook)\b(?:\s+(?:path|location))?\s*:\s+(?:the\s+)?`?(?:[^\s/\\)"'`]+[\\/])+[^\s/\\).,"'`]+`?(?=\s*(?:[,;]|[-–—](?:\s|$)))/iu;

const controlPlanePattern =
  /\.agentic-memory\b|\bcontrol[- ]plane\b|\bLLM-(?:vault-local|outside-vault)\b|\bMEMORY_ADAPTER\b/iu;

const evidenceMetadataPattern =
  /\bevidence\s+(?:id|identifier|metadata)\b|\bE\d+\b|\bvector\s+(?:score|distance|embedding)\b|\b(?:text[_ -]?hash|document[_ -]?path|chunk\s+id|passage\s+id|ordinal|cosine\s+(?:score|distance))\b/iu;

const modelProviderPattern =
  /\b(?:provider|model)(?:\s+(?:detail|id|name))?\s*:|\b(?:llama-server|EmbeddingGemma|Qwen\d*|agentic-memory-qwen[\w.-]*|OpenAI-compatible)\b/iu;

const routeOnlyGuidancePattern =
  /^\s*(?:[-*+]\s*)?(?:read|open|load|follow|see|refer to|use)\b.*\b(?:route|link|map|project|note|record|source|file|document)\b/iu;

const containsInternalDetail = (block: string): boolean =>
  markdownRoutePattern.test(block) ||
  documentPathPattern.test(block) ||
  contextualExtensionlessDocumentPathPattern.test(block) ||
  delimitedColonDocumentPathPattern.test(block) ||
  controlPlanePattern.test(block) ||
  evidenceMetadataPattern.test(block) ||
  modelProviderPattern.test(block) ||
  routeOnlyGuidancePattern.test(block);

const normalizeMarkdownFormatting = (text: string): string =>
  text
    .replace(/`+/gu, " ")
    .replace(/[*_~]/gu, "")
    .replace(/ +([.,!?;:])/gu, "$1")
    .replace(/ {2,}/gu, " ")
    .trim();

const stripMarkdownLinePrefix = (line: string): string =>
  line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/u, "");

const stripMarkdownFormatting = (block: string): string =>
  block
    .split(/\r?\n/u)
    .map((line) =>
      stripMarkdownLinePrefix(line)
        .split(/(?<=[.!?])\s+/u)
        .map(normalizeMarkdownFormatting)
        .filter((sentence) => !containsInternalDetail(sentence))
        .join(" "),
    )
    .filter((line) => line.length > 0)
    .join("\n");

export const prepareSafeRecallEvidence = (text: string): SafeRecallEvidence => {
  const safeBlocks = text
    .split(/\r?\n[ \t]*\r?\n/u)
    .map(stripMarkdownFormatting)
    .filter((block) => block.length > 0);
  const safeText = safeBlocks.join("\n\n");
  return safeText.length === 0 ? { _tag: "ineligible" } : { _tag: "eligible", text: safeText };
};
