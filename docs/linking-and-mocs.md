---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Critical Agentic Memory rules for MOCs, routing links, and semantic note links.
---

# Linking and MOCs

Linking is central to Agentic Memory. The system works because agents can decide what to read next without loading the whole vault.

## MOCs are routing surfaces

A MOC is a navigation note, not a content dump.

MOCs should contain links with enough context for an agent to decide whether to follow them.

Required MOC link format:

```md
- [[target-note]] — description. Read when: trigger or condition.
```

Example:

```md
- [[progressive-disclosure]] — explains the loading strategy for minimizing context usage. Read when: deciding what memory to load next.
```

Rules:

- Every routing link in a MOC should include a short description.
- Every routing link in a MOC must include `Read when:`.
- MOCs should point to other MOCs or atomic notes.
- MOCs should not duplicate the full content of atomic notes.
- If a MOC becomes large, split it into smaller MOCs and update `MEMORY.md`.

## `MEMORY.md` as root MOC

`MEMORY.md` is both core memory and the root MOC.

It should include:

- high-signal core context
- active memory pointers
- links to relevant MOCs
- short descriptions and read conditions

It should not become a long history file.

## Atomic notes are graph leaves

Atomic notes are durable Zettels. Each note should capture one reusable idea, decision, pattern, question, or concept.

A good atomic note is:

- focused
- concise
- source-aware when evidence matters
- semantically linked
- useful when read independently

## Semantic links in frontmatter

Atomic notes use Idea Compass-style semantic links.

```yaml
links:
  comes_from: []
  similar_to: []
  leads_to: []
  competes_with: []
```

Meanings:

- `comes_from` — origins, causes, parent ideas, broader categories.
- `similar_to` — sibling ideas, analogies, alternate framings.
- `leads_to` — applications, consequences, child ideas, next concepts.
- `competes_with` — tensions, opposites, tradeoffs, alternatives.

Prefer semantic links over a generic `related` field because semantic links explain why two notes are connected.

## Semantic links in the body

Atomic notes should also include a body section with readable semantic-link explanations.

Recommended format:

```md
## Semantic links

### Comes from
- [[zettelkasten-method]] — establishes atomic notes as individual reusable thought units. Read when: deciding note granularity.

### Similar to
- [[evergreen-note]] — related model for notes that improve over time.

### Leads to
- [[mocs-as-routing-surfaces]] — shows why maps are needed above atomic leaves. Read when: designing navigation.

### Competes with
- [[collector-fallacy]] — warns against collecting without distilling or connecting.
```

`Read when:` is mandatory in MOCs and recommended in atomic notes when the link is useful for progressive disclosure.

## Maturity and connectivity

Atomic notes should evolve from seedlings to evergreen notes.

Connectivity is one maturity signal:

- `seedling`: usually 0–1 semantic links
- `budding`: usually 2+ useful semantic links
- `evergreen`: usually 3+ meaningful semantic links, concise, stable, and reusable

Notes with fewer than 3 semantic links are candidates for:

- further linking
- merging
- pruning
- compaction
- remaining as draft until more connections emerge

## Orphans and graph debt

A note with no semantic links is graph debt unless intentionally isolated.

Graph debt should be handled during Reflection by:

- adding links
- marking the note as `draft`
- merging it into another note
- pruning or archiving it with approval
