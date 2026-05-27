# Linking and Memory Maps

Linking is central to Agentic Memory. The system works because agents can decide what to read next without loading the whole vault.

A **memory map** is a routing note. It points agents toward relevant context with short descriptions and explicit read conditions.

## Memory maps are routing surfaces

A memory map is not a content dump.

Maps should contain links with enough context for an agent to decide whether to follow them.

Required routing-link format:

```md
- [[notes/target-note]] — description. Read when: trigger or condition.
```

Example:

```md
- [[notes/progressive-disclosure]] — explains the loading strategy for minimizing context usage. Read when: deciding what memory to load next.
```

Rules:

- Every routing link in a map should include a short description.
- Every routing link in a map must include `Read when:`.
- Maps should primarily point to other maps or atomic notes.
- Maps may point to records when a work/event summary is useful.
- Maps may point to sources only when evidence is directly useful.
- Maps should not route to control-plane files under `.agentic-memory/`.
- Maps should not duplicate the full content of atomic notes.

Control-plane files are loaded through `AGENTS.md` and `.agentic-memory/LLMS.md`.

## Link resolution

Use vault-root-relative Obsidian wikilinks for memory content:

```md
[[maps/name]]
[[notes/name]]
[[sources/name]]
[[records/name]]
```

Rules:

- Omit `.md`.
- Prefer full vault-root-relative paths over bare `[[name]]`.
- Do not rely on Obsidian's shortest-path resolution.
- Avoid duplicate filenames across memory folders when practical.
- Use normal Markdown links for control-plane files in `.agentic-memory/` when needed.

## `MEMORY.md` as root memory map

`MEMORY.md` is both core memory and the root memory map.

It should link only to top-level maps that help route common or important future work.

A map should be linked from `MEMORY.md` when it is:

- broadly relevant across sessions
- an active project or thread
- a major area of responsibility
- a frequently used route
- a high-level map that leads to several submaps or notes
- important enough that future agents should see it early

A map can be omitted from `MEMORY.md` when it is:

- narrow and only useful through another map
- a submap under a larger topic
- temporary or draft
- rarely used
- only relevant after loading a parent map
- an implementation detail of a broader area

Rule of thumb: `MEMORY.md` should route to areas of work, not every map.

## Map depth

Maps may reference other maps, but keep depth shallow.

Preferred:

```text
MEMORY.md → map → note
```

Acceptable:

```text
MEMORY.md → map → map → note
```

Depth 3 map chains are allowed only for large domains and should be reviewed. Depth greater than 3 requires an explicit local deviation in `.agentic-memory/LLMS.md`.

Reflection should flag:

- any chain deeper than 2 map hops
- any map chain where agents repeatedly fail to find notes
- maps that should be lifted closer to `MEMORY.md`

## Atomic notes

Atomic notes are the smallest durable knowledge units in Agentic Memory. Each note should capture one reusable idea, decision, pattern, question, or concept.

A good atomic note is:

- focused
- concise
- understandable on its own
- source-aware when evidence matters
- semantically linked
- useful when read independently

A `## Use when` section is optional. Add it when the note's applicability is non-obvious, broad, frequently reused, or frequently misused. Routine routing guidance should live in memory-map links instead.

## Semantic links in frontmatter

Atomic notes use four semantic-link categories adapted from the Idea Compass pattern. The docs define the categories directly so agents do not need to know the external method.

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

- [[notes/source-idea]] — establishes this note's origin or parent concept. Read when: deciding whether the parent context matters.

### Similar to

- [[notes/sibling-idea]] — explains a related or analogous idea.

### Leads to

- [[notes/downstream-idea]] — explains a consequence or application. Read when: applying this note.

### Competes with

- [[notes/alternative-idea]] — explains a tension, opposite, or tradeoff.
```

`Read when:` is mandatory in memory maps and recommended in atomic notes when the link is useful for progressive disclosure.

## Purpose documentation

Memory maps should include:

```md
## Purpose

One or two sentences explaining what this map routes to.

## Routing

- [[notes/target]] — description. Read when: condition.
```

Atomic notes should include a clear title, one-line thesis or summary, and semantic links. Add `## Use when` only when useful.

## Maturity and connectivity

Atomic notes should evolve from seedlings to evergreen notes.

Connectivity is one maturity signal:

- `seedling`: usually 0–1 semantic links
- `budding`: usually 2+ useful semantic links
- `evergreen`: usually 3+ meaningful semantic links, concise, stable, and reusable

Other maturity signals:

- focus: one reusable idea
- context: understandable independently
- compression: within atomic-note budget
- source awareness: evidence cited when claims matter
- stability: not transient brainstorming
- non-duplication: does not overlap heavily with another note
- actionability: future agents can apply it

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
