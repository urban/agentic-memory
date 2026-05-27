---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Conservative migration guide from the existing Agentic Brain implementation to Agentic Memory v1.
---

# Agentic Brain to Agentic Memory v1 Migration

This migration converts the existing `agentic-brain` implementation into the simpler Agentic Memory v1 structure.

It is conservative/manual-assist by default because the source vault contains both system architecture and real personal/project memory.

## Target structure

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

## Source-to-target mapping

| Agentic Brain source | Agentic Memory v1 target | Notes |
|---|---|---|
| `AGENTS.md` | `AGENTS.md` | Refactor to generic/local entrypoint. |
| `MEMORY.md` | `MEMORY.md` | Compact into lean core memory + root MOC. |
| `instructions/**` | `instructions/**` | Simplify and deduplicate into v1 operating instructions. |
| `topics/**` | `mocs/` or `notes/` | Classify each file: routing map vs atomic note vs output. |
| `knowledge-base/notes/**` | `notes/` or `mocs/` | Split large pages into atomic notes where useful. |
| `knowledge-base/sources/**` | `sources/` | Preserve as immutable sources. |
| `sources/**` | `sources/` | Preserve as immutable sources. |
| `knowledge-base/outputs/**` | `outputs/` | Preserve durable artifacts. |
| `proposals/**` | `outputs/` or omit | Migrate only reusable artifacts. |
| `tools/**` | `notes/`, `mocs/`, or omit | Migrate only durable tool knowledge. |
| `knowledge-base/templates/**` | `templates/` | Normalize if still useful. |

## Migration phases

### Phase 0: Prepare

1. Create a Git branch or backup.
2. Confirm source and target paths.
3. Run `git status` and start from a clean or understood state.
4. Copy the Agentic Memory v1 starter template into the target vault.

### Phase 1: Inventory

Create a classification report before moving files.

For each source file, classify as:

- `core`
- `agent instruction`
- `moc`
- `atomic note`
- `source`
- `output`
- `template`
- `omit/defer`

Flag:

- oversized notes
- project-specific content
- duplicate or overlapping notes
- source material mixed with synthesis
- notes without clear future value

### Phase 2: Migrate system instructions

Refactor only the durable operating rules into local `instructions/`.

Remove unnecessary complexity and project-specific details.

Preserve these concepts:

- progressive disclosure
- `MEMORY.md` as root MOC
- MOCs as routing surfaces
- atomic notes as graph leaves
- semantic Idea Compass links
- source immutability
- Reflection workflow
- Git audit trail

### Phase 3: Compact `MEMORY.md`

Convert `MEMORY.md` into lean core memory + root MOC.

Move detail into:

- `mocs/` for routing
- `notes/` for atomic durable ideas
- `outputs/` for long artifacts
- `sources/` for evidence

Do not preserve long chronological project detail in core memory unless it is still broadly useful.

### Phase 4: Convert topics and knowledge notes

For each topic or knowledge page:

- If it mainly routes to other material, migrate as a MOC.
- If it contains one durable idea, migrate as an atomic note.
- If it contains multiple durable ideas, split into multiple atomic notes.
- If it is a final artifact, migrate as an output.
- If it is raw evidence, migrate as a source.
- If it is stale/noisy, defer or omit with review.

### Phase 5: Add metadata and links

For every managed file:

- normalize filename to kebab-case
- add required frontmatter
- preserve `created` when known
- set `updated` to migration date when materially changed
- add summaries
- add MOC routing links with `Read when:`
- add semantic-link scaffolds to atomic notes
- mark weak notes as `seedling` or `draft`

### Phase 6: Reflection and review

Run the Reflection skill on the migrated vault.

Review:

- MOC routing quality
- token budgets
- weakly connected notes
- stale content
- migration omissions
- proposed pruning/merges

Save a reflection summary source.

### Phase 7: Commit

Prepare a migration commit message:

```text
migration: convert agentic-brain to Agentic Memory v1
```

Ask before committing.

## Non-goals

- Do not automatically migrate every project note.
- Do not preserve noise just because it exists.
- Do not rewrite human-authored meaning without review.
- Do not flatten all sources into synthesis.
- Do not create a complex taxonomy.

## Success criteria

- The target vault is self-describing through `MEMORY_SYSTEM.md`.
- `MEMORY.md` is under budget and works as root MOC.
- MOCs route with descriptions and `Read when:` conditions.
- Atomic notes are smaller, semantically linked, and marked with maturity.
- Sources remain immutable.
- Outputs preserve reusable artifacts.
- Migration decisions are auditable in Git and/or a migration report.
