export type SafeRecallEvidence =
  | { readonly _tag: "ineligible" }
  | { readonly _tag: "eligible"; readonly text: string };

const markdownRoutePattern =
  /\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\[[^\]]*\]|^\s*\[[^\]]+\]:\s*\S+|\bread when\s*:|https?:\/\/\S+/iu;

const documentPathPattern =
  /(?:^|[\s("'`])(?:(?:[A-Z]:[\\/]|\.{0,2}[\\/])(?:[^\s/\\)"'`]+[\\/])*[^\s/\\)"'`]+|(?:[^\s/\\)"'`]+[\\/])+[^\s/\\)"'`]*\.[\p{L}\p{N}][\p{L}\p{N}_-]*|(?:MEMORY|USER|AGENTS)\.md\b)|\b(?:see|open|load|follow|visit|refer to|consult)\s+(?:the\s+)?(?:[^\s/\\)"'`]+[\\/])+[^\s/\\).,"'`]+/iu;

const bareDocumentNamePattern =
  /(?:^|[\s("'`])[^\s/\\)"'`]+\.(?:cjs|css|csv|db|docx?|gguf|html?|jsx?|json|md|markdown|mjs|pdf|py|rs|sh|sqlite|tsv|tsx?|txt|ya?ml)(?=$|[\s).,;:!?"'`])/iu;

const capitalizedDottedJavaScriptNamePattern = /\b\p{Lu}[\p{L}\p{N}-]*\.js\b/gu;

const dottedJavaScriptDocumentReferencePattern =
  /\b(?:(?:see|open|load|follow|visit|refer to|consult)\s+(?:the\s+)?|(?:file|document|path|runbook)(?:\s+(?:is|was|named|called))?\s+)\p{Lu}[\p{L}\p{N}-]*\.js\b|\b\p{Lu}[\p{L}\p{N}-]*\.js\s+(?:file|document|path|runbook)\b/iu;

const containsBareDocumentName = (block: string): boolean =>
  dottedJavaScriptDocumentReferencePattern.test(block) ||
  bareDocumentNamePattern.test(block.replace(capitalizedDottedJavaScriptNamePattern, ""));

const relativePathTokenPattern =
  /(?<![\p{L}\p{N}_-])(`?(?:[^\s/\\)"'`:]+[\\/])+[^\s/\\).,;!?"'`:]+`?)(?=$|[\s).,;:!?"'`])/giu;

const ordinarySlashTerms = new Set(["blue/green", "read/write"]);
const rateDenominatorPattern =
  /^(?:d|day|days|h|hour|hours|min|minute|minutes|s|sec|second|seconds)$/u;

const containsRelativePath = (block: string): boolean =>
  Array.from(block.matchAll(relativePathTokenPattern)).some((match) => {
    const rawToken = match[1];
    if (rawToken === undefined) {
      return false;
    }

    const token = rawToken.replaceAll("`", "").toLowerCase();
    const components = token.split(/[\\/]/u);
    const isNumericNotation = components.every((component) => /^\d+$/u.test(component));
    const tokenIndex = match.index;
    const precedingText = block.slice(0, tokenIndex);
    const denominator = components[1];
    const isRate =
      components.length === 2 &&
      denominator !== undefined &&
      rateDenominatorPattern.test(denominator) &&
      /\d+\s+$/u.test(precedingText);
    return !ordinarySlashTerms.has(token) && !isNumericNotation && !isRate;
  });

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

const promptReferencePattern =
  /\b(?:according\s+to|per|from|in|under)\s+(?:the\s+)?(?:(?:system|developer|user|input)\s+)?prompts?\b|\b(?:(?:a|an|the|this|that)\s+(?:(?:system|developer|user|input)\s+)?|(?:system|developer|user|input)\s+)prompts?\b|\bprompts?\s+(?:content|details?|instructions?|metadata)\b/iu;

const inherentRankingPredicatePattern = String.raw`(?:ranks?|ranked|scores?|scored)`;

const orderingPredicatePattern = String.raw`(?:places?|placed|orders?|ordered|positions?|positioned|prioritizes?|prioritized)`;

const rankingPositionPattern = String.raw`(?:first|last|top|bottom|highest|lowest|ahead)`;

const clauseRelativePositionPattern = String.raw`(?:first|last)`;

const locativeRankingPositionPattern = String.raw`(?:at|near)\s+(?:the\s+)?(?:top|bottom)`;

const explicitRankingAdverbPattern = String.raw`(?:overall|chronologically)`;

const rankingAdverbModifierPattern = String.raw`(?:${explicitRankingAdverbPattern}|[\p{L}-]+ly)`;

const ordinalSequenceAdverbPattern = String.raw`[\p{L}-]+(?:st|nd|rd|th)ly`;

const clauseDeterminerPattern = String.raw`(?:a|an|the|this|that|these|those|my|our|your|his|her|its|their)`;

const ordinalObjectDeterminerPattern = String.raw`(?:a|an|the|another|each|every|either|neither|some|any|no|my|our|your|his|her|its|their)`;

const ordinalObjectPremodifierPattern = String.raw`(?:very\s+)+`;

const postObjectRankingPositionPattern = String.raw`(?<!\b${ordinalObjectDeterminerPattern}\s)(?<!\b${ordinalObjectDeterminerPattern}\s${ordinalObjectPremodifierPattern})${rankingPositionPattern}`;

const demonstrativeDeterminerPattern = String.raw`(?:this|that|these|those)`;

const ordinalObjectLocativePattern = String.raw`(?:at|by|from|in|inside|near|on|outside|through|under|with|within)\s+(?:(?:${clauseDeterminerPattern})\s+[\p{L}-]+|[\p{L}-]+\s+[\p{L}-]+)`;

const coordinatingClausePattern = String.raw`(?:and|but|nor|or|so|yet)`;

const rankingClauseTerminatorPattern = String.raw`(?:$|[.!?,;:]|\b${coordinatingClausePattern}\b)`;

const demonstrativeOrdinalObjectPattern = String.raw`\b${demonstrativeDeterminerPattern}\s+(?:very\s+)*${rankingPositionPattern}\s+(?:(?!(?:${explicitRankingAdverbPattern}|${ordinalSequenceAdverbPattern})\b)[\p{L}-]+(?=\s*${rankingClauseTerminatorPattern})|[\p{L}-]+\s+${ordinalObjectLocativePattern})`;

const explicitSetScopePattern = String.raw`(?:among|within)\s+(?:${clauseDeterminerPattern}\s+)?[\p{L}-]+`;

const pluralScopePattern = String.raw`(?:in|inside)\s+${clauseDeterminerPattern}\s+[\p{L}-]+s`;

const compoundScopePattern = String.raw`(?:in|inside)\s+${clauseDeterminerPattern}\s+[\p{L}-]+\s+[\p{L}-]+`;

const ordinalSequenceScopePattern = String.raw`(?:among|in|inside|within)\s+(?:${clauseDeterminerPattern}\s+)?[\p{L}-]+`;

const demonstrativeRankingScopePattern = String.raw`\b(?:(?:${demonstrativeDeterminerPattern})\s+(?:very\s+)*${rankingPositionPattern}\s+(?:(?:${rankingAdverbModifierPattern})\s+(?:${explicitSetScopePattern}|${pluralScopePattern})|${ordinalSequenceAdverbPattern}\s+${ordinalSequenceScopePattern})|(?:this|these|those)\s+(?:very\s+)*${rankingPositionPattern}\s+${rankingAdverbModifierPattern}\s+${compoundScopePattern})\b`;

const bareRankingComplementTerminatorPattern = String.raw`(?:${rankingClauseTerminatorPattern}|\b(?:among|before|during|for|in|of|on|within)\b)`;

const rankingComplementPattern = String.raw`(?:${locativeRankingPositionPattern}|${postObjectRankingPositionPattern}\b(?:(?:\s+${rankingAdverbModifierPattern})+|(?=\s*${bareRankingComplementTerminatorPattern})))`;

const subordinateClauseIntroducerPattern = String.raw`(?:after|although|as|because|before|if|once|since|though|unless|until|when|whenever|whereas|while)`;

const personalPronounSubjectPattern = String.raw`(?:i|he|she|it|we|you|they)`;

const properNounSubjectPattern = String.raw`(?!(?:${clauseDeterminerPattern})\b)\p{Lu}[\p{L}'-]*`;

const barePluralSubjectPattern = String.raw`\p{Ll}[\p{L}'-]*s`;

const lexicalSubjectTermPattern = String.raw`[\p{L}'][\p{L}'-]*`;

const determinedSubjectPattern = String.raw`${clauseDeterminerPattern}\s+(?:${lexicalSubjectTermPattern}\s+)*${lexicalSubjectTermPattern}`;

const undeterminedClauseSubjectPattern = String.raw`(?:${personalPronounSubjectPattern}|${properNounSubjectPattern}|${barePluralSubjectPattern})`;

const auxiliaryPredicateStartPattern = String.raw`(?:am|are|is|was|were|can|could|did|do|does|had|has|have|may|might|must|shall|should|will|would)`;

const lexicalPredicateObjectPattern = String.raw`(?:${clauseDeterminerPattern}\s+[\p{L}'-]+|${personalPronounSubjectPattern}|${barePluralSubjectPattern})`;

const nonPredicateFunctionWordPattern = String.raw`(?:at|by|for|from|in|inside|near|of|on|outside|through|to|under|with|within)`;

const lexicalFinitePredicatePattern = String.raw`(?!(?:${rankingPositionPattern}|${nonPredicateFunctionWordPattern})\b)[\p{L}'-]+(?:\s+${lexicalPredicateObjectPattern}\b|(?=\s+${clauseRelativePositionPattern}\b))`;

const introducedFiniteClausePattern = String.raw`\b${subordinateClauseIntroducerPattern}\s+(?:${determinedSubjectPattern}|${undeterminedClauseSubjectPattern})\s+(?:${auxiliaryPredicateStartPattern}\b|${lexicalFinitePredicatePattern})(?=[^.!?]*\b${clauseRelativePositionPattern}\b)`;

const orderingRankingPredicatePattern = String.raw`${orderingPredicatePattern}\b(?:${demonstrativeOrdinalObjectPattern}|(?!(?:${introducedFiniteClausePattern})|${demonstrativeOrdinalObjectPattern}|[,:;])[^.!?])*\b${rankingComplementPattern}`;

const retrievalRankingPredicatePattern = String.raw`(?:${inherentRankingPredicatePattern}|${orderingRankingPredicatePattern})`;

const traceRankingPattern = new RegExp(
  String.raw`\b(?:(?:execution|inference|reasoning|retrieval)\s+)?(?:trace|ranking)s?\s+(?:content|details?|diagnostics?|metadata|shows?|showed|indicates?|indicated|reveals?|revealed|${orderingPredicatePattern}|${inherentRankingPredicatePattern})\b|\b(?:in|within|from|through|according\s+to)\s+(?:the\s+)?(?:(?:execution|inference|reasoning|retrieval)\s+)?(?:trace|ranking)s?\b|\b(?:retrieval\s+(?:${orderingPredicatePattern}\b[^.!?]*${demonstrativeRankingScopePattern}|${retrievalRankingPredicatePattern})|${inherentRankingPredicatePattern}\b[^.!?]{0,80}\bretrieval)\b`,
  "iu",
);

const routeOnlyGuidancePattern =
  /^\s*(?:[-*+]\s*)?(?:read|open|load|follow|see|refer to|use)\b.*\b(?:route|link|map|project|note|record|source|file|document)\b/iu;

const normalizeMarkdownForRankingSafetyMatching = (text: string): string =>
  text.replaceAll(/[*_~`]/gu, "");

const containsInternalDetail = (block: string): boolean =>
  markdownRoutePattern.test(block) ||
  documentPathPattern.test(block) ||
  containsBareDocumentName(block) ||
  containsRelativePath(block) ||
  contextualExtensionlessDocumentPathPattern.test(block) ||
  delimitedColonDocumentPathPattern.test(block) ||
  controlPlanePattern.test(block) ||
  evidenceMetadataPattern.test(block) ||
  modelProviderPattern.test(block) ||
  promptReferencePattern.test(block) ||
  traceRankingPattern.test(normalizeMarkdownForRankingSafetyMatching(block)) ||
  routeOnlyGuidancePattern.test(block);

export const isSafeRecallPublicText = (text: string): boolean =>
  text.trim().length > 0 && !containsInternalDetail(text);

const normalizeMarkdownFormatting = (text: string): string =>
  text
    .replaceAll(/`+/gu, " ")
    .replaceAll(/[*_~]/gu, "")
    .replaceAll(/ +([.,!?;:])/gu, "$1")
    .replaceAll(/ {2,}/gu, " ")
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
