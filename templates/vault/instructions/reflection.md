---
type: agent
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Local instructions for manual Reflection runs.
---

# Reflection

Reflection is the manual maintenance workflow for graph health, compaction, and usage-pattern learning.

## Inspect

- Git status
- `MEMORY.md` budget and routing quality
- MOC routing-link format
- atomic-note semantic links and maturity
- orphan or weakly connected notes
- stale or duplicated memory
- optional external session traces, if provided

## Do not store raw session logs

Session traces are external. If a durable summary is worth saving, save it as an immutable `source` with `source_type: reflection-summary`.

## Safe edits

Allowed directly:

- add missing frontmatter or summaries
- normalize MOC routing links
- add semantic-link scaffolds
- mark graph debt
- create reflection summary source

Ask before:

- deleting, pruning, or archiving notes
- materially rewriting `MEMORY.md`
- splitting or merging notes
- changing schema or instructions

## Closeout

- Save reflection summary source for substantial runs.
- Show what changed and why.
- Prepare a Git commit message.
- Ask before committing.
