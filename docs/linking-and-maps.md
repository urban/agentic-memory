# Linking and Memory Maps

Linking is central to Agentic Memory. The system works because agents can decide what to read next without loading the whole vault.

A **memory map** is a conceptual or domain framing note. It points agents toward relevant context with short descriptions and explicit read conditions.

A **project** is a project-specific routing note plus durable state for a recurring effort.

## Memory maps are framing and routing surfaces

A memory map is not a content dump.

Maps should capture the high-level concept, category, or domain that makes the routed files belong together. They should provide enough framing for an agent to understand the cluster before deciding what to read, while leaving detailed claims, decisions, and evidence in projects, atomic notes, records, people notes, or sources.

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
- Maps should primarily point to memory maps, projects, atomic notes, or people notes.
- Maps may point to records when a work/event summary is useful.
- Maps may point to sources only when evidence is directly useful.
- Maps should not route to control-plane files under `.agentic-memory/`.
- Maps should not duplicate the full content of atomic notes, project files, or people notes.

Control-plane files are reached through the vault-local `AGENTS.md` entry point or an external bootstrap, not through memory-map links.

## Maps versus projects

Use a `maps/` file when the page mainly frames a domain, category, topic, or conceptual cluster.

Use a `projects/` file when the page needs durable effort-specific state, such as:

- project status or lifecycle
- current state
- active goals
- key decisions and rationale
- open loops
- next useful context
- routing to subprojects, repos, records, or notes

A project can behave like a project-specific memory map, but it also owns current state. A map owns the reusable framing around a domain.

A group of projects should become a map when the value has shifted from tracking one effort to organizing a reusable domain of knowledge. Signals include:

- several projects share a category or domain
- agents need a routing hub for patterns across projects
- project-specific state is no longer the main reason to open the file
- repeated project observations have been promoted into atomic notes
- the page is mostly explaining the relationship among notes, projects, records, and sources

## Link resolution

Use vault-root-relative Obsidian wikilinks for memory content:

```md
[[MEMORY]]
[[USER]]
[[maps/name]]
[[projects/name]]
[[notes/name]]
[[people/name]]
[[sources/name]]
[[records/name]]
```

Rules:

- Omit `.md`.
- Prefer full vault-root-relative paths over bare `[[name]]`, except root files `[[MEMORY]]` and `[[USER]]`.
- Do not rely on Obsidian's shortest-path resolution.
- Avoid duplicate filenames across memory folders when practical.
- Use normal Markdown links for control-plane files in `.agentic-memory/` if such links are needed.

## `MEMORY.md` as root memory map

`MEMORY.md` is both core memory and the root memory map.

It should link only to top-level maps and projects that help route common or important future work.

A map should be linked from `MEMORY.md` when it is:

- broadly relevant across sessions
- a major area of responsibility
- a frequently used route
- a high-level map that leads to several submaps, projects, notes, people notes, records, or sources
- important enough that future agents should see it early

A project should be linked from the Projects section in `MEMORY.md` when it is:

- active or likely to recur
- an umbrella effort that routes multiple subprojects
- a project candidate that repeated sessions suggest may become durable
- a completed project whose decisions or patterns are still often useful

Omit a map or project from `MEMORY.md` when it is:

- narrow and only useful through another map or project
- a subproject under a larger project route
- temporary or draft
- rarely used
- only relevant after loading a parent map or project

Rule of thumb: `MEMORY.md` should route to areas of work and active/important projects, not every managed file.

## Map depth

Maps may reference other maps and projects, but keep depth shallow.

Preferred:

```text
MEMORY.md → map/project → note
```

Acceptable:

```text
MEMORY.md → map → map/project → note
```

Depth 3 map chains are allowed only for large domains and should be reviewed. Depth greater than 3 requires an explicit local deviation in `.agentic-memory/LLMS.md`.

Reflection should flag:

- any chain deeper than 2 map hops
- any map chain where agents repeatedly fail to find notes or projects
- maps or projects that should be lifted closer to `MEMORY.md`

## Project links and semantic links

Project files use routing links in the body and semantic links in frontmatter.

Routing links use the same format as maps:

```md
- [[records/2026-06-02-example-session]] — compact session outcome and rationale. Read when: reviewing what changed during the session.
```

Project semantic links use top-level properties:

```yaml
comes_from: []
similar_to: []
leads_to: []
competes_with: []
```

Allowed project semantic-link targets include:

```md
[[projects/name]]
[[maps/name]]
[[notes/name]]
```

Use them to express relationships such as:

- `comes_from` — parent/umbrella projects, source domains, originating concepts, or atomic notes that explain why this project exists.
- `similar_to` — sibling projects, analogous efforts, or related domains.
- `leads_to` — subprojects, downstream efforts, implementation tracks, or atomic notes likely to emerge from this project.
- `competes_with` — alternative efforts, tradeoff concepts, or rejected approaches.

Do not add a rigid `project_kind` field when semantic links can express the relationship.

## Atomic notes

Atomic notes are the smallest durable knowledge units in Agentic Memory. Each note should capture one reusable idea, decision, pattern, question, preference, or concept.

A good atomic note is:

- focused
- concise
- understandable on its own
- source-aware when evidence matters
- semantically linked
- useful when read independently

A `## Use when` section is optional. Add it when the note's applicability is non-obvious, broad, frequently reused, or frequently misused. Routine routing guidance should live in memory-map or project links instead.

## People notes

People notes live in `people/` and use `type: person`. They capture durable context about a specific person other than the vault owner, not an abstract idea.

Create a people note only when the person is meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context. Do not create person notes for names that appear only incidentally in raw sources, competitor pages, citations, articles, or historical captures.

People notes should prefer evidence-backed, non-sensitive, useful context. Mark uncertainty visibly and avoid inferring private or sensitive traits.

Maps and projects may route to people notes with the same routing-link format:

```md
- [[people/jane-doe]] — collaboration context and preferences. Read when: preparing for work involving Jane.
```

## User memory links

`USER.md` lives at the vault root and uses `type: user`. It should be lean and pointer-heavy.

Use `USER.md` for stable owner facts, communication preferences, glossary meanings, and compact links to detailed user-pattern notes. Use `notes/` for reusable user observations that need detail, semantic links, or cross-project evidence.

Examples:

```md
- Explicit: The user prefers stack-ranked options when making prioritization decisions; see [[notes/stack-ranked-decision-options]].
- Inferred: The user may prefer phased implementation plans; verify before relying on this. Evidence appears in [[projects/example-project]].
```

## Semantic links in frontmatter

Atomic notes use four top-level semantic-link properties adapted from the Idea Compass pattern. Project files use the same properties for project/domain relationships.

```yaml
comes_from: []
similar_to: []
leads_to: []
competes_with: []
```

Meanings for atomic notes:

- `comes_from` — origins, causes, parent ideas, broader categories.
- `similar_to` — sibling ideas, analogies, alternate framings.
- `leads_to` — applications, consequences, child ideas, next concepts.
- `competes_with` — tensions, opposites, tradeoffs, alternatives.

Prefer semantic links over a generic `related` field because semantic links explain why two files are connected.

Atomic-note semantic links usually point to other atomic notes. They may point to `[[maps/name]]` or `[[projects/name]]` when the relationship is genuinely semantic, not merely navigational.

Use Obsidian-compatible list formatting. Non-empty semantic-link lists should be block lists with quoted internal links:

```yaml
similar_to:
  - "[[notes/sibling-idea]]"
```

## Semantic links in the body

Atomic notes should also include a body callout with readable semantic-link explanations. Project files may include the same callout when the semantic relationships need explanation.

Recommended format:

```md
> [!info] Semantic links
>
> **Comes from**:
>
> - [[notes/source-idea]] — establishes this note's origin or parent concept. Read when: deciding whether the parent context matters.
>
> **Similar to**:
>
> - [[notes/sibling-idea]] — explains a related or analogous idea.
>
> **Leads to**:
>
> - [[notes/downstream-idea]] — explains a consequence or application. Read when: applying this note.
>
> **Competes with**:
>
> - [[notes/alternative-idea]] — explains a tension, opposite, or tradeoff.
```

`Read when:` is mandatory in memory maps and project routing sections. It is recommended in semantic-link body callouts when the link is useful for progressive disclosure.

## Purpose documentation

Memory maps should include:

```md
## Purpose

One or two sentences explaining what this memory map frames and routes to.

## Routing

- [[notes/target]] — description. Read when: condition.
```

Project files should include current-state sections plus routing links. Atomic notes should include a clear title, one-line thesis or summary, and semantic links. Add `## Use when` only when useful.

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
- non-duplication: does not overlap heavily with another note, project, or user-memory entry
- actionability: future agents can apply it
- cross-project value: repeated project observations have been promoted out of project files when appropriate

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

Project files can also create graph debt when they duplicate cross-project insights that should become atomic notes or `USER.md` entries.
