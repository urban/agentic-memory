---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Migration philosophy and versioned migration structure for Agentic Memory.
---

# Migration

Agentic Memory is designed to evolve without trapping memory in hidden tool state.

Migration should be explicit, reviewable, and Git-auditable.

## Version contract

Each vault carries a local `MEMORY_SYSTEM.md` file that declares:

- Agentic Memory version
- required structure
- local deviations
- migration notes
- canonical spec reference, if applicable

## Migration locations

This repository stores migrations under:

```text
migrations/
└── source-to-target/
    ├── MIGRATION.md
    ├── SKILL.md
    └── scripts/
```

A migration may include:

- human migration guide
- agent migration skill
- optional deterministic scripts
- validation checklist
- rollback advice

## Migration principles

- Prefer conservative/manual-assist migrations for human-owned memory.
- Never destroy source material during migration.
- Preserve authorship, dates, and rationale when possible.
- Keep old-to-new mappings explicit.
- Normalize structure gradually.
- Use Git branches or commits as checkpoints.
- Ask before pruning, archiving, or materially rewriting user-authored memory.

## Current migration

The initial migration path is:

```text
migrations/agentic-brain-to-v1/
```

It helps move the existing Agentic Brain implementation into the simpler Agentic Memory v1 model.

The migration is intentionally conservative because the source repository contains both:

- memory-system architecture
- real personal/project memory

The first pass should classify and propose moves before making destructive changes.
