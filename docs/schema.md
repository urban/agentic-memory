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
version: 0.3.0
---
```

Skills and future tooling should use the same version value. Agentic Memory does not separately version schema, skills, packages, or migrations.

## Required files and folders

```text
AGENTS.md
MEMORY.md
USER.md
.agentic-memory/LLMS.md
.agentic-memory/instructions/writing-memory.md
.agentic-memory/instructions/linking-and-maps.md
.agentic-memory/instructions/cross-project-persistence.md
.agentic-memory/instructions/reflection.md
.agentic-memory/templates/map.md
.agentic-memory/templates/project.md
.agentic-memory/templates/note.md
.agentic-memory/templates/person.md
.agentic-memory/templates/record.md
.agentic-memory/templates/reflection-record.md
.agentic-memory/templates/source.md
.agentic-memory/templates/user.md
maps/
projects/
notes/
people/
sources/
records/
```

## Managed file roles

Allowed managed memory `type` values are only:

```yaml
type: core|user|map|project|note|person|source|record
```

Meanings:

- `core` — root memory and root memory map, normally `MEMORY.md`.
- `user` — root-level durable context about the vault owner / primary user, normally `USER.md`.
- `map` — conceptual/domain framing and routing surface.
- `project` — durable state and routing for a recurring effort, project candidate, active project, completed project, archived project, or umbrella effort.
- `note` — atomic knowledge unit.
- `person` — durable profile or context note about a specific person other than the vault owner.
- `source` — immutable captured evidence.
- `record` — append-stable recall summary of work or events.

Do not add semantic categories like `preference`, `decision`, or `concept` to `type`. Use links, maps, headings, and optional tags instead. `project` is a managed role because recurring efforts need lifecycle state and project-specific routing that maps and records do not provide.

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

## Project status values

`type: project` files require a separate lifecycle field:

```yaml
project_status: candidate|active|completed|archived
```

- `candidate` — early or tentative recurring effort observed from one or more sessions.
- `active` — current effort that future sessions may need to resume.
- `completed` — finished effort whose memory remains useful for recall and pattern extraction.
- `archived` — retained historical project context that is no longer expected to guide active work.

`status` describes whether the memory file is usable. `project_status` describes the effort lifecycle. A completed project may still have `status: active` if the file is current and useful.

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
- Atomic-note and project semantic links are top-level list properties: `comes_from`, `similar_to`, `leads_to`, and `competes_with`.

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

## Core memory frontmatter

`MEMORY.md` uses `type: core`.

```yaml
---
type: core
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "Core memory and root memory map."
aliases:
  - "Memory"
---
```

## User memory frontmatter

`USER.md` uses `type: user` and lives at the vault root next to `MEMORY.md`.

```yaml
---
type: user
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "Lean durable context about the vault owner."
aliases:
  - "User"
tags: []
sources: []
---
```

Recommended body sections:

```md
# User

## Profile

## Communication

## Glossary

## Preferences and working patterns

## Inferred preferences

## Related notes
```

`USER.md` should stay lean and pointer-heavy. Detailed reusable user patterns belong in `notes/` and should be linked from `USER.md`. Mark whether preferences are explicit, repeatedly observed, or inferred.

## Project frontmatter

`type: project` files live in `projects/` and capture durable state plus routing for recurring efforts.

```yaml
---
type: project
status: active
project_status: candidate
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "One-line project summary."
aliases:
  - "Project Name"
tags: []
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with: []
---
```

Allowed semantic-link targets for project frontmatter include `[[projects/name]]`, `[[maps/name]]`, and `[[notes/name]]`. Use project semantic links to express umbrella/subproject relationships, domain relationships, conceptual support, and competing efforts instead of adding rigid project-kind fields.

Recommended body sections:

```md
# Project Name

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

Project files should avoid duplicating facts that can be cheaply derived from source code, repository files, or obvious current project state. Dated work history belongs in `records/`.

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

Atomic-note semantic links usually point to other atomic notes, but may point to `[[maps/name]]` or `[[projects/name]]` when the relationship is genuinely semantic rather than merely navigational.

Connectivity is only one quality signal. Reflection should also evaluate focus, independent context, compression, source awareness, stability, non-duplication, actionability, and whether repeated project observations should be promoted into the note.

## Person frontmatter

`type: person` files live in `people/` and capture durable context about a specific person other than the vault owner. Create person notes only for people who are meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context. Do not create person notes for names that appear only incidentally in raw sources, citations, competitor pages, or historical captures.

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
- Prefer full vault-root-relative paths over bare `[[name]]`, except for root files `[[MEMORY]]` and `[[USER]]`.
- Do not rely on Obsidian's shortest-path resolution.
- Avoid duplicate filenames across memory folders when practical.
- Use normal Markdown links for control-plane files in `.agentic-memory/` when such links are needed.

## Naming conventions

- Use kebab-case filenames for managed files in folders.
- Root files `MEMORY.md` and `USER.md` are uppercase exceptions.
- Use ISO dates for dated source and record files.
- Keep folders flat by default.
- Use frontmatter `aliases` for human-friendly titles.

Examples:

```text
maps/memory-architecture.md
projects/agentic-memory-v0-3-rollout.md
notes/progressive-disclosure.md
people/jane-doe.md
sources/2026-05-27-session-usage-summary.md
records/2026-05-27-reflection.md
```

## Token and word budgets

Budgets are soft limits with warning thresholds.

| File type   |     Soft budget | Warning threshold |
| ----------- | --------------: | ----------------: |
| `MEMORY.md` | 500–1,000 words |      >1,500 words |
| `USER.md`   |   250–800 words |      >1,200 words |
| Memory map  |   300–800 words |      >1,200 words |
| Project     |   300–900 words |      >1,500 words |
| Atomic note |   150–500 words |        >800 words |
| Person note |   100–500 words |        >800 words |
| Source      | no fixed budget | not loaded by default |
| Record      |   150–700 words |      >1,000 words |

Reflection should flag files over warning thresholds.

## Git

Agentic Memory vaults are assumed to be Git-backed. Memory changes should be auditable through Git history.

Agents may inspect `git status` and `git diff` to summarize changes, but should not commit automatically. The human commits manually unless explicitly instructing an agent to commit in that moment.
