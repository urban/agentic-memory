# Linking, Maps, and Projects

Navigation policy. For persistence/layer choice, read `writing-memory.md`.

## Wikilinks

Use vault-root-relative Obsidian links for memory content:

```md
[[MEMORY]] [[USER]] [[maps/name]] [[projects/name]] [[notes/name]] [[people/name]] [[sources/name]] [[records/name]]
```

Omit `.md`. Prefer full paths except root files. Avoid duplicate filenames across folders. Use normal Markdown links for `.agentic-memory/` files if needed.

## Routing links

Every route in `MEMORY.md`, maps, and project routing sections uses:

```md
- [[path/name]] — short description. Read when: condition.
```

Description + `Read when:` must be sufficient to decide whether to load the target.

## Maps vs projects

- Map (`maps/`, `type: map`): high-level concept/category/domain framing and routes. Explain why linked files belong together; do not duplicate them.
- Project (`projects/`, `type: project`): project-specific map plus durable effort state: lifecycle, current state, goals, decisions/rationale, open loops, next context, subproject routing.

If a project/group mainly organizes reusable knowledge rather than active effort state, route through or convert toward a map.

## `MEMORY.md`

Route only to top-level maps and active/important projects: recurring work, umbrella efforts, important candidates, or completed projects with reusable decisions/patterns. Do not list every file.

Keep depth shallow: preferred `MEMORY → map/project → note`; acceptable `MEMORY → map → map/project → note`; review deeper chains during Reflection.

## Semantic links

Notes and projects use top-level frontmatter lists:

```yaml
comes_from: []
similar_to: []
leads_to: []
competes_with: []
```

Meanings:

- `comes_from`: origins, parents, causes, umbrellas, source domains.
- `similar_to`: siblings, analogies, related domains.
- `leads_to`: applications, consequences, subprojects, downstream tracks.
- `competes_with`: alternatives, tensions, tradeoffs, rejected approaches.

Atomic-note semantic links usually target notes; projects may target projects, maps, or notes. Use quoted wikilinks in non-empty frontmatter lists.

Body semantic-link callouts are optional when links need explanation. `Read when:` is required for routes and recommended for semantic links that guide loading.

## Graph quality flags

During review, flag orphan notes, content-dump maps, over-deep map chains, projects that became maps, duplicated routes, and project-local insights that should be promoted to `notes/` or `USER.md`.
