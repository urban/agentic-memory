---
name: agentic-brain-to-agentic-memory-v1
description: Conservatively migrate an existing Agentic Brain vault to Agentic Memory v1 with classification, review, and non-destructive restructuring.
---

# Agentic Brain to Agentic Memory v1 Migration Skill

Use this skill when the user asks to migrate an existing Agentic Brain implementation into Agentic Memory v1.

## Goal

Produce a simpler, self-describing Agentic Memory v1 vault while preserving valuable memory, authorship, source boundaries, and Git auditability.

## Required stance

Be conservative.

Classify and propose before destructive changes. Ask before deleting, archiving, heavily rewriting, splitting, or merging user-owned memory.

## Inputs

Confirm:

- source Agentic Brain path
- target Agentic Memory path
- whether to migrate all content or only system-level memory
- whether project-specific memory should be included, deferred, or omitted

## Procedure

### 1. Read migration guide

Read `migrations/agentic-brain-to-v1/MIGRATION.md`.

### 2. Inspect source structure

Inventory source files from:

- `AGENTS.md`
- `MEMORY.md`
- `instructions/`
- `topics/`
- `knowledge-base/`
- `sources/`
- `proposals/`
- `tools/`
- `templates/`

Do not assume every file should migrate.

### 3. Create classification report

For each file, classify as:

- core
- agent instruction
- MOC
- atomic note
- source
- output
- template
- omit/defer

Flag:

- oversized notes
- content dumps
- project-specific notes
- duplicate concepts
- source/synthesis mixing
- migration risks

Ask for review before large moves.

### 4. Create or update target scaffold

Copy or create the Agentic Memory v1 structure:

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

### 5. Migrate core and instructions

- Refactor `MEMORY.md` into lean core memory + root MOC.
- Simplify instructions into Agentic Memory v1 operating files.
- Remove project-specific implementation details unless the user asks to keep them.

### 6. Migrate notes and MOCs

For each selected memory file:

- convert routing pages into `mocs/`
- convert one-idea pages into `notes/`
- split overloaded notes only with approval
- preserve raw captures in `sources/`
- preserve reusable artifacts in `outputs/`

Normalize filenames to kebab-case.

### 7. Add schema metadata

Add frontmatter according to Agentic Memory v1.

For atomic notes, include:

```yaml
maturity: seedling|budding|evergreen
links:
  comes_from: []
  similar_to: []
  leads_to: []
  competes_with: []
```

Add `## Semantic links` sections where possible.

### 8. Preserve audit trail

Create an output migration report if the migration is substantial.

Suggested path:

```text
outputs/YYYY-MM-DD-agentic-brain-to-v1-migration-report.md
```

Include:

- source path
- target path
- files migrated
- files omitted/deferred
- transformations applied
- unresolved questions
- follow-up Reflection recommendations

### 9. Run Reflection

After migration, run the Reflection skill or prepare a Reflection checklist.

Focus on:

- token budget health
- MOC routing quality
- semantic link scaffolds
- weak/seedling notes
- stale or duplicated material

### 10. Close out

- Show `git status`.
- Summarize what changed.
- List items needing human review.
- Propose a commit message.
- Ask before committing.

Suggested commit message:

```text
migration: convert agentic-brain to Agentic Memory v1
```
