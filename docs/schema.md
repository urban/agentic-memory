---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Agentic Memory schema, metadata, naming, and token-budget rules.
---

# Schema

This document defines the Agentic Memory filesystem and metadata contract.

## Required files and folders

```text
AGENTS.md
MEMORY.md
MEMORY_SYSTEM.md
instructions/
mocs/
notes/
sources/
outputs/
templates/
```

## File roles

Allowed `type` values:

```yaml
type: core|moc|note|source|output|template|schema|agent
```

Meanings:

- `core` — root memory and root MOC, normally `MEMORY.md`.
- `moc` — routing map of content.
- `note` — atomic Zettel / graph leaf.
- `source` — immutable captured evidence or source-like record.
- `output` — durable generated artifact.
- `template` — reusable file template.
- `schema` — system contract or documentation.
- `agent` — agent-facing instruction file.

Do not add semantic categories like `project`, `preference`, `decision`, or `concept` to `type`. Use links, MOCs, headings, and optional tags instead.

## Status values

Allowed `status` values:

```yaml
status: draft|active|stale|archived
```

- `draft` — incomplete, untrusted, or weakly connected.
- `active` — current and usable.
- `stale` — may be outdated; verify before relying on it.
- `archived` — retained for history, not current guidance.

## Required frontmatter

All managed Markdown files should include frontmatter, except `AGENTS.md` when harness compatibility requires plain instructions.

Minimum:

```yaml
---
type: note
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: One-line summary.
---
```

Optional common fields:

```yaml
aliases: []
tags: []
sources: []
links:
  comes_from: []
  similar_to: []
  leads_to: []
  competes_with: []
```

## Atomic note frontmatter

`type: note` files require `maturity` and semantic-link scaffolding.

```yaml
---
type: note
status: draft
maturity: seedling
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: One-line summary.
sources: []
links:
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

An active atomic note should ideally have at least 3 semantic links. Notes below that threshold are candidates for linking, merging, pruning, or compaction.

## Source frontmatter

Sources are immutable after capture.

```yaml
---
type: source
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_type: article|book|note|session-summary|reflection-summary|other
summary: One-line summary.
source_url:
generated_by:
---
```

For reflection summaries, use:

```yaml
source_type: reflection-summary
generated_by: agent
```

## Output frontmatter

```yaml
---
type: output
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
output_type: answer|briefing|handoff|spec|migration-report|other
summary: One-line summary.
sources: []
---
```

## Naming conventions

- Use kebab-case filenames for managed files.
- Use ISO dates for dated source and output files.
- Keep folders flat by default.
- Use frontmatter `aliases` for human-friendly titles.

Examples:

```text
mocs/agent-operations.md
notes/progressive-disclosure.md
sources/2026-05-26-reflection-summary.md
outputs/2026-05-26-session-handoff.md
```

## Token and word budgets

Budgets are soft limits with warning thresholds.

| File type   |     Soft budget |     Warning threshold |
| ----------- | --------------: | --------------------: |
| `MEMORY.md` | 500–1,000 words |          >1,500 words |
| MOC         |   300–800 words |          >1,200 words |
| Atomic note |   150–500 words |            >800 words |
| Source      | no fixed budget | not loaded by default |
| Output      | no fixed budget |  must include summary |

Reflection should flag files over warning thresholds.

## Git

Agentic Memory vaults are assumed to be Git-backed. Memory changes should be auditable through Git history.

Suggested commit prefixes:

```text
memory:
reflection:
migration:
```
