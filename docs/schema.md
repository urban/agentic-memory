# Schema

This document defines the Agentic Memory filesystem and metadata contract.

## Versioning

Agentic Memory uses one lock-step version field.

In a vault, the version is declared in:

```text
.agentic-memory/LLMS.md
```

Use:

```yaml
---
version: 0.2.0
---
```

Skills and future tooling should use the same version value. Agentic Memory does not separately version schema, skills, packages, or migrations.

## Required files and folders

```text
AGENTS.md
MEMORY.md
.agentic-memory/LLMS.md
.agentic-memory/instructions/writing-memory.md
.agentic-memory/instructions/linking-and-maps.md
.agentic-memory/instructions/reflection.md
.agentic-memory/templates/map.md
.agentic-memory/templates/note.md
.agentic-memory/templates/person.md
.agentic-memory/templates/record.md
.agentic-memory/templates/reflection-record.md
.agentic-memory/templates/source.md
maps/
notes/
people/
sources/
records/
```

## Managed file roles

Allowed managed memory `type` values are only:

```yaml
type: core|map|note|person|source|record
```

Meanings:

- `core` — root memory and root memory map, normally `MEMORY.md`.
- `map` — memory map / routing surface.
- `note` — atomic knowledge unit.
- `person` — durable profile or context note about a specific person.
- `source` — immutable captured evidence.
- `record` — append-stable recall summary of work or events.

Do not add semantic categories like `project`, `preference`, `decision`, or `concept` to `type`. Use links, maps, headings, and optional tags instead.

Control-plane files under `.agentic-memory/` are not managed memory files and do not require Agentic Memory `type` frontmatter. This includes `LLMS.md`, instruction files, and templates.

## Status values

Allowed `status` values for managed memory files:

```yaml
status: draft|active|stale|archived
```

- `draft` — incomplete, untrusted, or weakly connected.
- `active` — current and usable.
- `stale` — may be outdated; verify before relying on it.
- `archived` — retained for history, not current guidance.

There is no `deleted` status. Use Git history for deleted files, and require explicit human approval before deletion.

## Obsidian-compatible frontmatter rules

Managed Markdown files use YAML frontmatter shaped for Obsidian Properties.

Rules:

- Use Obsidian's default property name `aliases`, not deprecated `alias`.
- Every managed page must include at least one human-readable alias, usually matching the H1.
- Quote `summary` values.
- List properties may be empty inline lists, such as `tags: []`.
- Non-empty list properties should use YAML block-list format.
- Internal links in frontmatter list values must be quoted.
- Do not use nested frontmatter properties. Obsidian does not fully support nested properties in the Properties UI.
- Atomic-note semantic links are top-level list properties: `comes_from`, `similar_to`, `leads_to`, and `competes_with`.

Example list formatting:

```yaml
aliases:
  - "Progressive Disclosure"
tags: []
sources:
  - "[[sources/example-source]]"
similar_to:
  - "[[notes/related-note]]"
```

## Required frontmatter

Managed Markdown files should include frontmatter, except `AGENTS.md` and all `.agentic-memory/**` control-plane files.

Minimum for managed memory files:

```yaml
---
type: note
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "One-line summary."
aliases:
  - "Human Readable Title"
---
```

Optional common fields:

```yaml
tags: []
sources: []
```

## Atomic note frontmatter

`type: note` files require `maturity` and top-level semantic-link scaffolding.

```yaml
---
type: note
status: draft
maturity: seedling
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "One-line summary."
aliases:
  - "Human Readable Title"
tags: []
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with: []
---
```

Allowed `maturity` values:

```yaml
maturity: seedling|budding|evergreen
```

Heuristic:

- `seedling` — early idea, 0–1 semantic links, incomplete or weakly connected.
- `budding` — useful standalone idea with partial graph connections.
- `evergreen` — durable, concise, source-aware when needed, and usually 3+ meaningful semantic links.

Connectivity is only one quality signal. Reflection should also evaluate focus, independent context, compression, source awareness, stability, non-duplication, and actionability.

## Person frontmatter

`type: person` files live in `people/` and capture durable context about a specific person. Create person notes only for people who are meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context. Do not create person notes for names that appear only incidentally in raw sources, citations, competitor pages, or historical captures.

```yaml
---
type: person
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "Short context about this person."
aliases:
  - "Person Name"
tags: []
sources: []
---
```

Recommended body sections:

```md
# Person Name

## Context

## Preferences and communication style

## Projects and associations

## Important facts

## Open questions

## Related
```

Preserve privacy and uncertainty. Do not infer sensitive traits or private facts without explicit evidence.

## Source frontmatter

Sources are immutable after capture.

```yaml
---
type: source
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "One-line summary."
aliases:
  - "Source Title"
---
```

Do not add source-specific metadata fields by default. If provenance matters, put it visibly in the body.

## Record frontmatter

Records are append-stable recall summaries, not full artifact storage.

```yaml
---
type: record
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
record_type: work|decision|handoff|migration|reflection|session|other
summary: "One-line record summary."
aliases:
  - "Record Title"
sources: []
---
```

Records should capture:

- what happened or was created
- when it happened
- why it mattered
- how it was done
- key takeaways or insights
- where the full artifact lives, if applicable

Records may be corrected or linked over time, but should not be rewritten to erase original rationale. Use dated correction or update sections when understanding changes.

## Link conventions

Use vault-root-relative Obsidian wikilinks for memory content:

```md
[[maps/name]]
[[notes/name]]
[[people/name]]
[[sources/name]]
[[records/name]]
```

Rules:

- Omit `.md`.
- Prefer full vault-root-relative paths over bare `[[name]]`.
- Do not rely on Obsidian's shortest-path resolution.
- Avoid duplicate filenames across memory folders when practical.
- Use normal Markdown links for control-plane files in `.agentic-memory/` when such links are needed.

## Naming conventions

- Use kebab-case filenames for managed files.
- Use ISO dates for dated source and record files.
- Keep folders flat by default.
- Use frontmatter `aliases` for human-friendly titles.

Examples:

```text
maps/memory-architecture.md
notes/progressive-disclosure.md
people/jane-doe.md
sources/2026-05-27-session-usage-summary.md
records/2026-05-27-reflection.md
```

## Token and word budgets

Budgets are soft limits with warning thresholds.

| File type   |     Soft budget |     Warning threshold |
| ----------- | --------------: | --------------------: |
| `MEMORY.md` | 500–1,000 words |          >1,500 words |
| Memory map  |   300–800 words |          >1,200 words |
| Atomic note |   150–500 words |            >800 words |
| Person note |   100–500 words |            >800 words |
| Source      | no fixed budget | not loaded by default |
| Record      |   150–700 words |          >1,000 words |

Reflection should flag files over warning thresholds.

## Git

Agentic Memory vaults are assumed to be Git-backed. Memory changes should be auditable through Git history.

Agents may inspect `git status` and `git diff` to summarize changes, but should not commit automatically. The human commits manually unless explicitly instructing an agent to commit in that moment.
