# PRD: Agentic Memory Recall — Current-State Ranking (Batch 3)

## Status

Partially approved requirements. Human approval of the project and entity disambiguation tracer slice was recorded through Task Manager Ticket `186prw` after the Wayfinder interview and final document review. The remaining Batch 3 slices are intentionally unresolved and must be planned through their own human-owned Tickets.

This document is the source of truth for approved Batch 3 requirements as they are resolved. It does not override the Slice 1 public Recall contract or the approved Batch 2 benchmark contract except for the narrow expected-ambiguity benchmark extension defined below.

Active planning documents belong under root `specs/`. Earlier `.specs/` documents remain authoritative where this PRD explicitly cites them, but new Batch 3 planning is recorded here.

## Summary

Batch 3 adds deterministic Agentic Memory policy ranking after semantic candidate retrieval. The first tracer slice makes an explicitly named project or other managed subject beat semantically similar distractors through the complete public Recall path:

```text
one singular factual question
→ explicit named-target resolution
→ current semantic-index guard
→ EmbeddingGemma query embedding
→ bounded libSQL exact-cosine candidate retrieval
→ current Markdown hydration and private metadata enrichment
→ deterministic project-disambiguation policy
→ bounded eligible evidence
→ existing local Qwen synthesis and grounding
→ existing public answer, safe abstention, or typed ambiguity failure
```

The slice preserves semantic retrieval as the only evidence-retrieval mechanism. Metadata resolves identity and ranks candidates already admitted by semantic search; it never acts as lexical fallback evidence retrieval.

## Relationship to Existing Contracts

### Slice 1 remains authoritative

`.specs/PRD-agentic-memory-recall-slice-1-mvp.md` continues to own shipped Recall behavior:

- one singular factual question;
- current semantic index required before retrieval;
- EmbeddingGemma query embeddings;
- libSQL exact-cosine semantic search;
- current Markdown hydration;
- source exclusion before the candidate limit;
- bounded evidence and one structured grounded claim;
- local loopback Qwen synthesis;
- `answered | not_found` successful responses;
- public fields limited to `status`, `question`, `answer`, and `warnings`.

This slice adds private target-resolution and policy-ranking behavior. It does not add a success status or public ranking diagnostics.

### Batch 2 remains the black-box acceptance boundary

`specs/PRD-agentic-memory-recall-benchmark.md` remains authoritative for:

- one complete canonical suite;
- two synthetic fixture vaults;
- the real public Recall CLI as the subject;
- one canonical Git baseline;
- independent `openai-codex/gpt-5.6-sol` judgment at high reasoning;
- Correct `1.0`, Partially correct `0.5`, and Incorrect `0.0`;
- single-run directional deltas rather than statistical claims;
- model-free normal repository validation.

Batch 3 cases must remain opaque black-box observations of public CLI behavior. They must not import Recall, ranking, semantic-index, metadata, evidence, or synthesis internals.

## Current Implementation Baseline

The shipped implementation currently:

- retrieves the top 10 source-excluded exact-cosine chunks;
- returns semantic identity as document path, chunk ordinal, and text hash while discarding distance;
- hydrates each selected chunk from current Markdown and verifies its ordinal and text hash;
- strips route-only and unsafe internal text;
- preserves semantic candidate order into evidence preparation;
- selects at most five passages, five documents, two passages per document, and approximately 4,500 tokens;
- exposes no candidate, metadata, path, score, or ranking details publicly.

`ManagedMemory` already owns parsing for:

- managed memory layer;
- document title;
- frontmatter `aliases`;
- content `status`;
- project `project_status`;
- frontmatter summary.

The semantic index currently stores document layer, title, content status, and project status, but not aliases. Its public Recall candidate shape does not expose distance, semantic rank, title, aliases, or project association. The implementation of the private metadata seam is therefore future production work and is not prescribed by this PRD.

## Slice 3A — Named-Target and Project Disambiguation

### Outcome

When a singular question explicitly names one unambiguous project or managed subject, Recall selects evidence for that target instead of semantically similar evidence belonging only to a competing project. When the explicit name resolves to multiple targets, Recall fails with actionable ambiguity guidance rather than pretending that memory is absent.

### Domain vocabulary

#### Named target

An eligible non-source managed document explicitly identified in the question by its complete canonical title or one declared alias.

Use **named target** instead of the overloaded term **entity** in this slice. A named project is a named target whose managed memory layer is `project`.

#### Canonical title

The current human-facing title owned by the managed document parser, normally derived from its H1 and otherwise from its managed path.

#### Declared alias

A nonempty value from the document's existing frontmatter `aliases` property. An alias is an authoritative alternate name, not a weaker search keyword.

#### Ambiguous named target

An explicit normalized name that resolves to more than one eligible managed document. Ambiguity is an identity-resolution failure even if one matching document ranks more strongly in semantic search.

#### Target-associated evidence

A hydrated semantic candidate explicitly associated with the named project through one of these deterministic signals:

- the candidate belongs to the named project document;
- its title, aliases, or answer-bearing hydrated passage contains a complete normalized name of the target project;
- its existing `comes_from` metadata directly identifies the target project.

Other semantic-link fields do not establish project ownership in this slice. Reading existing association metadata is classification, not route expansion: it cannot add a linked document to the semantic candidate pool.

#### Competing-project-only evidence

A hydrated semantic candidate explicitly associated with one or more projects, none of which is the named target.

#### Project-neutral evidence

A hydrated semantic candidate with no explicit project association. Project-neutral does not mean generally relevant; it remains subject to semantic ordering, evidence safety, budgets, and synthesis grounding.

## Named-Target Resolution

### Matching normalization

Normalize the question, canonical titles, and aliases using only:

1. one deterministic Unicode normalization form;
2. locale-independent case normalization;
3. replacement of each Unicode whitespace run with one ASCII space;
4. trimming of leading and trailing whitespace.

A match requires the complete normalized name as a bounded contiguous phrase in the normalized question.

Normalization must preserve internal punctuation. It must not perform:

- stemming or lemmatization;
- accent removal;
- punctuation stripping;
- hyphen-to-space equivalence;
- acronym generation;
- token-subset matching;
- fuzzy, phonetic, or edit-distance matching.

Examples:

- `Alpha Product` matches `ALPHA   PRODUCT`;
- `Alpha` does not match `Alphabet`;
- `Alpha-2` does not match `Alpha 2` unless both are declared names.

### Title and alias authority

Canonical titles and declared aliases have equal identity strength. A title match never silently overrides an alias match.

If one project has canonical title `Atlas` and another declares alias `Atlas`, the name is ambiguous.

### Resolution scope

Resolution examines the complete eligible non-source managed-document namespace, independently of semantic candidate rank. This guarantee is necessary because a duplicate title or alias outside the semantic top-K remains a real identity collision.

Resolution does not make matched documents evidence candidates. A named target that is absent from the semantic candidate pool cannot be rescued by title or alias lookup.

Sources are absent from the namespace for this slice. Content `status` and project `project_status` do not resolve collisions; lifecycle authority belongs to a separate Batch 3 slice.

### Ambiguity behavior

Any unresolved exact-name collision produces a typed `AmbiguousRecallTarget` failure before synthesis.

The failure:

- exits nonzero through the existing CLI failure envelope;
- does not return `not_found`;
- does not add an `ambiguous` Recall success status;
- states that multiple targets matched;
- instructs the user to name one target more specifically and retry;
- includes at most five distinct canonical titles in deterministic normalized-title order;
- does not expose document paths, memory layers, statuses, scores, passages, aliases, semantic ranks, or ranking diagnostics.

When duplicate documents have the same canonical title, the message may show that title once and state that multiple documents matched. It must not expose internal locators merely to distinguish them.

Example human guidance:

```text
“Shared Retry” matches multiple targets: Alpha Product and Beta Platform. Name one target more specifically and retry.
```

This is still one question with multiple possible referents. It is not a multipart question.

## Candidate and Metadata Seams

The exact module names and physical storage are implementation decisions. The implementation must nevertheless provide private domain operations equivalent to the following responsibilities.

### Named-target resolver

```text
question + complete eligible managed metadata
→ no explicit target
| one resolved named target
| ambiguous named target + bounded canonical titles
```

The metadata boundary needs only:

- stable owning-document identity;
- canonical title;
- declared aliases;
- managed memory layer;
- explicit direct project association needed by this slice.

It must not expose filesystem or index conventions outside its owning module.

### Semantic candidate retrieval

```text
vault + question + source exclusion + limit 50
→ ordered exact-cosine semantic candidates
```

Each private candidate retains enough information for hydration, policy, and deterministic order:

- owning-document identity;
- chunk ordinal;
- provenance hash;
- semantic distance and source semantic rank.

Sources must be excluded before the 50-candidate limit. The semantic module continues to own database location, vector representation, SQL schema, exact-cosine execution, and stable raw ordering.

### Policy candidate enrichment

Hydration and metadata enrichment may classify a semantic candidate as:

- target-associated;
- project-neutral;
- competing-project-only.

Enrichment must use current authoritative Markdown and owned metadata. It must preserve existing hydration and provenance failures. It cannot fetch, add, or expand a document that semantic retrieval did not return.

## Deterministic Project Policy

When no explicit named project resolves, this slice adds no project partition. Existing semantic ordering and evidence policies remain authoritative.

When exactly one named project resolves, apply policy in this order:

1. Remove every competing-project-only candidate.
2. Place target-associated candidates before project-neutral candidates.
3. Preserve exact-cosine semantic order within each policy tier.
4. If candidates remain exactly tied, order by stable vault-relative document identity and then chunk ordinal.
5. Apply existing evidence safety, overlap removal, per-document limits, passage limits, document limits, and token limits.
6. Invoke the existing synthesis and grounding path with only the selected bounded packet.

A candidate explicitly involving both the target and another project remains target-associated. For example, an Alpha record explaining why Alpha rejected Beta's retry window may remain eligible for an Alpha question. A Beta-only retry-policy note is ineligible.

If no sufficient target-associated or project-neutral evidence answers the question, Recall returns the existing `not_found` response. It must not substitute a competing project's fact.

## Public Contract and Failure Semantics

### Successful Recall response

Unchanged:

```json
{
  "status": "answered",
  "question": "For Alpha Product, what retry policy applies?",
  "answer": "Alpha Product uses a 200ms p95 latency budget for interactive retry scheduling.",
  "warnings": []
}
```

The only successful statuses remain `answered` and `not_found`.

### Ambiguous target failure

Uses the existing CLI failure envelope with stable code `AmbiguousRecallTarget`:

```json
{
  "status": "failed",
  "error": {
    "code": "AmbiguousRecallTarget",
    "message": "Shared Retry matches multiple targets: Alpha Product and Beta Platform. Name one target more specifically and retry."
  },
  "warnings": []
}
```

The exact safe punctuation may follow repository output conventions, but the code, semantic meaning, bounded title list, and retry guidance are required.

### Existing failures

Question validation, semantic-index readiness, embedding, search, hydration, synthesis, and grounding failures retain their existing semantics. An ambiguity failure is user-correctable target resolution, not an operational provider or storage failure.

## Benchmark Extension and Cases

### Narrow expectation extension

The approved Batch 2 case contract supports only `answered` and `not_found`. Batch 3 adds one narrow expected public-failure variant for `AmbiguousRecallTarget`.

For that variant:

- the benchmark still invokes the real public Recall CLI;
- the exact decoded `AmbiguousRecallTarget` code and required safe canonical titles produce deterministic Correct `1.0`;
- the case does not call the model judge;
- an `answered` or `not_found` success instead produces deterministic Incorrect `0.0` and records the expectation violation;
- a malformed failure envelope, another failure code, subprocess failure, timeout, decode failure, or other operational failure invalidates the run rather than becoming a scored answer;
- the public error message is checked for forbidden internal details;
- the case remains equal weight in the complete canonical suite.

This extension does not add partial runs, tags, filters, alternate baselines, repeated trials, thresholds, or new judge behavior.

Adding the Batch 3 cases changes the corpus fingerprint and requires a reviewed complete `--update` run under the approved canonical-baseline policy.

### Fixture metadata

In the `project-memory` fixture, declare names equivalent to:

- Alpha Product aliases: `Alpha Product`, `Project A`, and `Shared Retry`;
- Beta Platform aliases: `Beta Platform`, `Alpha Batch Platform`, and `Shared Retry`.

Canonical titles remain `Alpha Product` and `Beta Platform`. Fixture phrasing may be refined while preserving the exact identity relationships and authoritative facts.

### Required black-box cases

#### Canonical Alpha versus Beta

Question:

```text
For Alpha Product, what retry scheduler policy applies?
```

Expected:

- `answered`;
- reference answer states Alpha's `200ms p95` interactive retry-scheduling budget;
- forbidden facts include Beta's `5 second batch retry window`.

#### Unique alias

Question:

```text
For Project A, what retry scheduler policy applies?
```

Expected:

- `answered`;
- reference answer states Alpha's `200ms p95` interactive retry-scheduling budget;
- forbidden facts include Beta's `5 second batch retry window`.

#### Competing similar name

Question:

```text
For Alpha Batch Platform, what retry policy applies?
```

Expected:

- `answered`;
- reference answer states Beta's `5 second batch retry window`;
- forbidden facts include Alpha's `200ms p95` budget.

#### Ambiguous alias

Question:

```text
What retry policy applies to Shared Retry?
```

Expected:

- nonzero public failure;
- code `AmbiguousRecallTarget`;
- safe message identifies canonical titles `Alpha Product` and `Beta Platform`;
- guidance asks the user to name one target and retry;
- no model judge call.

## Deterministic Test Requirements

Future implementation acceptance must prove through owning-package tests that:

- normalization is deterministic across case, Unicode form, and whitespace;
- bounded phrase matching does not match substrings such as `Alpha` inside `Alphabet`;
- punctuation-preserving names do not gain undeclared equivalents;
- title and alias matches have equal authority;
- duplicate names outside the semantic candidate pool still cause ambiguity;
- ambiguity stops before synthesis;
- ambiguity messages are bounded, stably ordered, and free of private internals;
- unique aliases resolve to the intended target;
- competing-project-only candidates are excluded;
- target-associated candidates precede neutral candidates;
- semantic ordering is preserved within policy tiers;
- final ties are stable by document identity and ordinal;
- metadata resolution cannot inject evidence outside the top 50 semantic candidates;
- absent target evidence produces `not_found` rather than a competitor answer;
- successful public Recall JSON remains unchanged;
- all four benchmark cases run through the public CLI;
- the ambiguity benchmark case bypasses the judge;
- normal tests remain model-free.

## Implementation Acceptance Criteria

This tracer slice is implementation-complete only when:

1. one public Recall invocation demonstrates canonical project disambiguation end to end;
2. one unique alias demonstrates the same end-to-end behavior;
3. one semantically tempting similar name selects the explicitly named competing project correctly;
4. one duplicate alias produces the approved typed ambiguity failure and safe retry guidance;
5. semantic exact-cosine retrieval remains the sole evidence candidate mechanism;
6. source exclusion occurs before the 50-candidate limit;
7. metadata lookup cannot rescue a non-semantic document into evidence;
8. competing-project-only evidence cannot reach synthesis for a named-project question;
9. project-neutral evidence remains eligible but cannot precede target-associated evidence;
10. the existing successful Recall response schema is byte-shape compatible;
11. the complete canonical benchmark and deterministic repository suite pass;
12. `bun run check` passes;
13. no deferred Batch 3 policy is implemented accidentally.

These are acceptance requirements for future implementation planning. This PRD does not create implementation Tickets.

## Explicit Non-Goals and Deferred Boundaries

This slice does not decide or implement:

- active, draft, stale, archived, candidate, completed, accepted, or rejected authority;
- current-state conflict resolution beyond project identity;
- historical or rationale-question policy;
- record or historical-material preference;
- evidence pooling, per-document max-pooling changes, or additional deduplication;
- source inclusion or `--include-sources`;
- route, wikilink, map, project, or graph expansion;
- QMD or another candidate provider;
- lexical fallback retrieval;
- fuzzy entity extraction or generic named-entity recognition;
- approximate vector search;
- model-based reranking;
- multipart or intentional multi-target comparison answers;
- multiple claims, partial support, or public citations;
- public paths, metadata, scores, evidence, candidate diagnostics, or ranking explanations;
- lifecycle-based resolution of duplicate names.

These boundaries may be revisited only by their owning roadmap batch or remaining Batch 3 planning Ticket.

## Remaining Batch 3 Planning

The following sibling decisions remain unresolved and must not be inferred from this slice:

- current-state authority;
- historical conflict policy;
- evidence pooling and deduplication placement.

Their eventual sections must preserve the named-target behavior and private/public boundaries approved here unless a later human decision explicitly revises this section.

## Approval Gate

Final human approval of this document section confirms:

- the named-target vocabulary and exact matching contract;
- title/alias equality;
- typed ambiguity failure and safe title guidance;
- complete metadata resolution without lexical evidence fallback;
- the top-50 semantic candidate boundary;
- hard exclusion of competing-project-only evidence;
- deterministic policy and tie order;
- the four black-box acceptance cases;
- the narrow expected-ambiguity benchmark extension;
- all explicit non-goals and sibling-Ticket boundaries.

Approval of this section does not approve implementation work or resolve the remaining Batch 3 planning Tickets.
