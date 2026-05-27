---
name: agentic-memory-reflection
description: Run a manual Agentic Memory Reflection pass for graph health, compaction, token budgets, MOC routing quality, semantic links, and optional external session usage patterns.
---

# Agentic Memory Reflection

Use this skill when the user asks to reflect, compact, dream, lint, consolidate, or improve an Agentic Memory vault.

## Goal

Improve long-term memory health while preserving human ownership and auditability.

Reflection inspects:

- memory graph structure
- token budgets
- MOC routing quality
- atomic-note semantic links
- note maturity
- stale or duplicated memory
- optional external agent session traces

## Important boundaries

- Raw session logs are external to Agentic Memory. Do not copy raw logs into the vault.
- If a session-usage summary is worth preserving, save it as an immutable source with `source_type: reflection-summary`.
- Treat reflection summaries as time-bound agent rationale records, not canonical policy.
- Ask before deleting, archiving, splitting, merging, or materially rewriting memory.
- Ask before committing to Git.

## Procedure

### 1. Locate the vault

Confirm the Agentic Memory root. It should contain:

- `AGENTS.md`
- `MEMORY.md`
- `MEMORY_SYSTEM.md`
- `mocs/`
- `notes/`
- `sources/`
- `outputs/`

### 2. Establish baseline

- Read `MEMORY_SYSTEM.md`.
- Read `MEMORY.md`.
- Read `instructions/reflection.md` if present.
- Run `git status` if the vault is Git-backed.
- Ask for external session traces if the user wants usage-pattern analysis and has not provided them.

### 3. Inspect token budgets

Flag likely compaction targets:

- `MEMORY.md` over 1,500 words
- MOCs over 1,200 words
- atomic notes over 800 words
- repeated content copied across files
- outputs without summaries

### 4. Inspect MOCs

Check every MOC routing link follows:

```md
- [[target]] — description. Read when: condition.
```

Fix obvious formatting issues directly. Propose larger routing changes.

### 5. Inspect atomic notes

Check `notes/*.md` for:

- required frontmatter
- `maturity`
- `links.comes_from`, `links.similar_to`, `links.leads_to`, `links.competes_with`
- body `## Semantic links` section
- fewer than 3 semantic links
- orphan or weakly connected notes

Add missing scaffolds when safe. Propose substantive link changes when uncertain.

### 6. Inspect optional external session traces

When provided, look for:

- repeatedly loaded files
- ignored files
- failed searches
- missing MOCs
- confusing instructions
- repeated edits to the same memory area
- notes reachable only by direct search

Summarize durable usage findings without storing raw logs.

### 7. Make safe improvements

Allowed directly:

- add missing summaries
- add missing frontmatter scaffolds
- normalize MOC routing-link format
- add obvious semantic-link scaffolds
- mark graph debt
- update `updated` dates
- create reflection summary source

Require approval for high-impact changes.

### 8. Save reflection summary

For every substantial run, create:

```text
sources/YYYY-MM-DD-reflection-summary.md
```

Include:

- context available
- what was inspected
- changes made
- why changes were made
- changes proposed but not made
- usage patterns observed
- open follow-up questions
- Git status and commit notes

### 9. Close out

- Show `git status`.
- Summarize what changed and why.
- Provide a proposed commit message.
- Ask before committing.

Suggested commit message:

```text
reflection: improve memory graph health YYYY-MM-DD
```
