---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Reflection workflow for memory graph health and session feedback.
---

# Reflection Workflow

Reflection is the maintenance loop that keeps Agentic Memory useful over time.

It covers what some memory systems call reflection, compaction, dreaming, consolidation, linting, or graph health checking.

## Purpose

Reflection improves the memory system by inspecting:

1. the memory graph itself
2. agent usage patterns from external session traces, when provided

It should strengthen navigation, reduce context cost, and preserve useful rationale for future agents.

## Trigger

Reflection is manually triggered through the companion skill at `skills/reflection/SKILL.md`.

Reflection is automation-compatible, but not automatic.

## Session traces

Session data is external to Agentic Memory.

Rules:

- Do not store raw session logs in the memory vault.
- Reflection may inspect external session traces when the user provides them.
- Durable summaries of session usage may be saved only when useful.
- If saved, summaries belong in `sources/` as immutable evidence.
- Interpretation derived from summaries belongs in `notes/`, `mocs/`, `MEMORY.md`, or `outputs/`.

## Passes

### 1. Context and Git baseline

- Inspect `MEMORY_SYSTEM.md`.
- Inspect `git status` when the vault is Git-backed.
- Record what files and optional session traces are available.

### 2. Token budget health

Flag:

- `MEMORY.md` above warning threshold
- MOCs that contain too much explanation
- atomic notes above warning threshold
- repeated content duplicated across files
- outputs that lack summaries

### 3. MOC routing quality

Check:

- MOC links follow `[[target]] — description. Read when: condition.`
- `MEMORY.md` routes to relevant MOCs.
- MOCs are not content dumps.
- routing links are useful enough for progressive disclosure.

### 4. Semantic link health

Check atomic notes for:

- required `links:` frontmatter
- body `## Semantic links` section
- meaningful Idea Compass categories
- orphan notes
- weak or unexplained links

### 5. Note maturity

Check:

- `type: note` has `maturity`
- `active` + `seedling` tensions
- notes with fewer than 3 semantic links
- candidates for `seedling` → `budding` → `evergreen`
- candidates for merge, pruning, or compaction

### 6. Session usage feedback

When external session traces are provided, look for:

- files agents repeatedly loaded
- files agents ignored
- repeated failed searches
- missing MOCs
- confusing instructions
- repeated edits to the same memory area
- notes that are found only by direct search, not graph navigation

Use these patterns to improve routing and semantic links.

### 7. Safe edits and proposals

Allowed directly:

- add missing summaries
- add or fix frontmatter
- add obvious semantic-link scaffolds
- normalize MOC routing-link format
- mark graph debt
- update `updated` dates
- create the reflection summary source

Require approval before:

- deleting notes
- archiving notes
- materially rewriting `MEMORY.md`
- splitting or merging large notes
- changing schema or instructions
- altering user-authored meaning
- substantively changing mature evergreen notes

### 8. Reflection summary source

Every substantial Reflection run should create an immutable source file:

```text
sources/YYYY-MM-DD-reflection-summary.md
```

It records the agent's rationale at the time, based on the context available.

Frontmatter:

```yaml
---
type: source
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_type: reflection-summary
generated_by: agent
summary: Reflection run summary for graph health, token budgets, and memory usage patterns.
---
```

Required body sections:

```md
# Reflection Summary

This is an agent-generated maintenance summary. Treat it as a time-bound rationale record, not as canonical system policy.

## Context available

## What was inspected

## Changes made

## Why changes were made

## Changes proposed but not made

## Usage patterns observed

## Open follow-up questions

## Git status and commit
```

### 9. Git closeout

Reflection assumes the vault is Git-backed.

At the end:

- show `git status`
- summarize changes
- prepare a commit message
- ask before committing

Suggested commit message:

```text
reflection: improve memory graph health YYYY-MM-DD
```
