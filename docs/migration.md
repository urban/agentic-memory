# Migration

Agentic Memory is designed to evolve without trapping memory in hidden tool state.

Migration should be explicit, reviewable, and Git-auditable.

## Version contract

Each vault carries two local control-plane contract files:

```text
.agentic-memory/LLM-vault-local.md
.agentic-memory/LLM-outside-vault.md
```

Their frontmatter contains the same lock-step Agentic Memory version:

```yaml
---
version: 0.3.0
---
```

Their bodies describe required structure, local deviations, small local term definitions, mode-specific startup routing, and migration notes.

Agentic Memory uses one lock-step `version` field rather than separate schema, package, and skill versions.

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
- Do not commit automatically; let the human review diffs and commit manually.

## Current migration

The current schema-level migration is `migrations/v0.2.0-to-v0.3.0/MIGRATION.md`.

The previous schema-level migration was `migrations/v0.1.0-to-v0.2.0/MIGRATION.md`.
