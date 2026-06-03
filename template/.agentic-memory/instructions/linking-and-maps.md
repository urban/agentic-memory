# Linking, Memory Maps, and Projects

Read this file when creating maps, creating projects, creating atomic notes, creating people notes, adding links, evaluating note maturity, or reviewing project routing.

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

## Memory-map link format

Every routing link in a memory map must use:

```md
- [[path/to-file]] — description. Read when: condition.
```

This lets agents decide whether to load the linked file.

## Memory-map structure

Memory maps should include:

```md
## Purpose
One or two sentences explaining what concept, category, or domain this map frames and routes to.

## Routing
- [[notes/target-note]] — short description. Read when: condition.
```

Maps should primarily point to other maps, projects, atomic notes, or people notes. They may point to records when a work/event summary is useful and to sources only when evidence is directly useful.

Maps should not route to control-plane files under `.agentic-memory/`. Control-plane files are loaded through `AGENTS.md` and `.agentic-memory/LLMS.md`.

Maps should provide framing and context for the files they route to. They should capture a high-level concept supported by atomic notes and projects, not duplicate the detailed contents of those files.

## Projects versus maps

Use a project file when the subject has durable effort-specific state:

- project lifecycle or status
- current state
- active goals
- key decisions and rationale
- open questions
- next useful context
- routing to subprojects, maps, notes, people, records, sources, or repos

Use a memory map when the subject mainly frames a reusable domain/category and routes to supporting files.

A group of projects should become a memory map when the value has shifted from tracking an effort to organizing reusable knowledge across efforts.

## Top-level maps and projects

`MEMORY.md` should link only to top-level maps and projects that help route common or important future work.

Link a map from `MEMORY.md` when it is broadly relevant, active, frequently used, or a high-level route to several submaps, projects, notes, people notes, records, or sources.

Link a project from the Projects section in `MEMORY.md` when it is active, recurring, an important project candidate, an umbrella effort, or a completed project whose decisions/patterns remain frequently useful.

Omit a map or project from `MEMORY.md` when it is narrow, draft, rare, temporary, or only useful after loading a parent map or project.

## Map depth

Maps may reference other maps and projects, but keep depth shallow:

- preferred: `MEMORY.md → map/project → note`
- acceptable: `MEMORY.md → map → map/project → note`
- depth 3 map chains are allowed only for large domains and should be reviewed
- depth greater than 3 requires an explicit local deviation in `.agentic-memory/LLMS.md`

Reflection should flag chains deeper than 2 map hops.

## Project structure

Project files should include:

```md
## Purpose

## Current state

## Active goals

## Key decisions and rationale

## User observations and working patterns

## Open questions

## Next useful context

## Routing

## Semantic links
```

Every routing link in a project file should use the same routing-link format:

```md
- [[records/example]] — short description. Read when: condition.
```

Project files should avoid facts that can be cheaply re-read from project source files.

## Project semantic links

Projects use semantic links in frontmatter as top-level properties:

```yaml
comes_from: []
similar_to: []
leads_to: []
competes_with: []
```

Allowed targets include `[[projects/name]]`, `[[maps/name]]`, and `[[notes/name]]`.

Meanings for projects:

- `comes_from` — parent/umbrella projects, source domains, originating concepts, or atomic notes that explain why this project exists.
- `similar_to` — sibling projects, analogous efforts, or related domains.
- `leads_to` — subprojects, downstream efforts, implementation tracks, or atomic notes likely to emerge from this project.
- `competes_with` — alternative efforts, tradeoff concepts, or rejected approaches.

Use semantic links instead of adding rigid project-kind fields when graph links can express the relationship.

## Atomic note structure

Atomic notes should include a clear title, one-line thesis or summary, and semantic links.

A `## Use when` section is optional. Add it when applicability is non-obvious, broad, frequently reused, or frequently misused. Routine routing guidance belongs in memory-map and project routing links.

## Atomic note semantic links

Atomic notes use semantic links in frontmatter as top-level properties:

```yaml
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

Atomic-note semantic links usually point to other atomic notes. They may point to `[[maps/name]]` or `[[projects/name]]` when the relationship is genuinely semantic, not merely navigational.

Use Obsidian-compatible list formatting. Non-empty semantic-link lists should be block lists with quoted internal links:

```yaml
similar_to:
  - "[[notes/related-note]]"
```

Atomic notes also include body explanations in a Markdown callout:

```md
> [!info] Semantic links
>
> **Comes from**:
>
> - [[notes/source-idea]] — explanation. Read when: condition.
>
> **Similar to**:
>
> - [[notes/sibling-idea]] — explanation. Read when: condition.
>
> **Leads to**:
>
> - [[notes/downstream-idea]] — explanation. Read when: condition.
>
> **Competes with**:
>
> - [[notes/alternative-idea]] — explanation. Read when: condition.
```

Project files may use the same body callout when their semantic links need explanation.

`Read when:` is required in memory maps and project routing sections and recommended for semantic-link body entries that guide future loading.

## User memory

`USER.md` lives at the vault root and uses `type: user`. It captures lean owner context and links to detailed atomic notes when needed.

Use `USER.md` for:

- stable profile facts
- explicit long-lived preferences
- user-specific glossary terms
- communication and formatting preferences
- inferred preferences, clearly labeled
- links to atomic notes about user patterns

Do not use `USER.md` for unbounded biography, project details, or overconfident speculation.

## People notes

People notes live in `people/` and use `type: person`. They capture durable context about a specific person other than the vault owner, not an atomic idea.

Create a people note only when the person is meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

Do not create person notes for names that appear only incidentally in raw sources, competitor pages, citations, articles, or historical captures.

People notes should use this general structure:

```md
# Person Name

## Context

## Preferences and communication style

## Projects and associations

## Important facts

## Open questions

## Related
```

Use visible uncertainty markers. Do not infer sensitive traits or private facts without explicit evidence.

## Maturity target

Atomic notes should mature toward `evergreen` and ideally have 3+ meaningful semantic links.

Other maturity signals:

- one reusable idea
- understandable independently
- within token budget
- source-aware when claims matter
- stable enough to reuse
- non-duplicative
- actionable for future agents
- promoted out of project memory when repeated across projects

Weakly connected notes are graph debt and should be revisited during Reflection.
