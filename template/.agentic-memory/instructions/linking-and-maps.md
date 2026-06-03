# Linking, Memory Maps, and Projects

Read when adding links, creating maps/projects, or reviewing navigation. For persistence policy and promotion criteria, use `.agentic-memory/instructions/writing-memory.md`.

## Link format

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
- Prefer full vault-root-relative paths over bare links, except root files `[[MEMORY]]` and `[[USER]]`.
- Avoid duplicate filenames across memory folders when practical.
- Use normal Markdown links for `.agentic-memory/` control-plane files if needed.

## Routing links

Every routing link in `MEMORY.md`, maps, and project routing sections must use:

```md
- [[path/to-file]] — description. Read when: condition.
```

Descriptions should be short but useful enough to decide whether to load the target.

## Maps versus projects

Maps (`maps/`, `type: map`) frame a high-level concept, category, or domain and route to supporting files. A map should explain why its linked notes/projects belong together without duplicating them.

Projects (`projects/`, `type: project`) are project-specific memory maps plus durable state. Use a project when the file needs lifecycle/status, current state, goals, decisions/rationale, open questions, next useful context, or subproject routing.

A group of projects should become or link to a map when its main value shifts from tracking an effort to organizing reusable knowledge across efforts.

## `MEMORY.md` routing

`MEMORY.md` should link only to top-level maps and active/important projects:

- maps that are broadly relevant, frequently used, or route many files
- projects that are active, recurring, umbrella efforts, important candidates, or completed projects with reusable decisions/patterns

Do not list every file. Route through parent maps/projects when possible.

## Map depth

Keep routing shallow:

- preferred: `MEMORY.md → map/project → note`
- acceptable: `MEMORY.md → map → map/project → note`
- deeper chains should be reviewed during Reflection

## Project semantic links

Projects use frontmatter semantic links:

```yaml
comes_from: []
similar_to: []
leads_to: []
competes_with: []
```

Allowed targets include `[[projects/name]]`, `[[maps/name]]`, and `[[notes/name]]`.

Meanings:

- `comes_from` — parent/umbrella projects, source domains, or originating concepts.
- `similar_to` — sibling projects, analogous efforts, or related domains.
- `leads_to` — subprojects, downstream efforts, implementation tracks, or concepts likely to emerge.
- `competes_with` — alternative efforts, tradeoff concepts, or rejected approaches.

Use semantic links instead of rigid project-kind fields when graph links explain the relationship.

## Atomic-note semantic links

Atomic notes use the same frontmatter properties:

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

Atomic-note semantic links usually point to other notes, but may point to maps or projects when the relationship is semantic rather than merely navigational.

Use Obsidian-compatible block lists with quoted wikilinks:

```yaml
similar_to:
  - "[[notes/related-note]]"
```

Atomic notes should include a body callout explaining semantic links when useful. `Read when:` is required for routing links and recommended for semantic-link explanations that guide loading.

## Graph quality

Good navigation is shallow, explicit, DRY, and purpose-labeled. Reflection should flag orphan notes, over-deep map chains, maps that became content dumps, projects that became domain maps, and project-local insights that should be promoted to atomic notes or `USER.md`.
