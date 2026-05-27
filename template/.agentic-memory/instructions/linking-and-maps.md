# Linking and Memory Maps

Read this file when creating maps, creating atomic notes, adding links, or evaluating note maturity.

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
One or two sentences explaining what this map routes to.

## Routing
- [[notes/target-note]] — short description. Read when: condition.
```

Maps should primarily point to other maps or atomic notes. They may point to records when a work/event summary is useful and to sources only when evidence is directly useful.

Maps should not route to control-plane files under `.agentic-memory/`. Control-plane files are loaded through `AGENTS.md` and `.agentic-memory/LLMS.md`.

## Top-level maps

`MEMORY.md` should link only to top-level maps that help route common or important future work.

Link a map from `MEMORY.md` when it is broadly relevant, active, frequently used, or a high-level route to several submaps or notes.

Omit a map from `MEMORY.md` when it is narrow, draft, rare, temporary, or only useful after loading a parent map.

## Map depth

Maps may reference other maps, but keep depth shallow:

- preferred: `MEMORY.md → map → note`
- acceptable: `MEMORY.md → map → map → note`
- depth 3 map chains are allowed only for large domains and should be reviewed
- depth greater than 3 requires an explicit local deviation in `.agentic-memory/LLMS.md`

Reflection should flag chains deeper than 2 map hops.

## Atomic note structure

Atomic notes should include a clear title, one-line thesis or summary, and semantic links.

A `## Use when` section is optional. Add it when applicability is non-obvious, broad, frequently reused, or frequently misused. Routine routing guidance belongs in memory-map links.

## Atomic note semantic links

Atomic notes use semantic links in frontmatter:

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

They also include body explanations:

```md
## Semantic links

### Comes from
- [[notes/source-idea]] — explanation. Read when: condition.
```

`Read when:` is required in memory maps and recommended for atomic-note links that guide future loading.

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

Weakly connected notes are graph debt and should be revisited during Reflection.
