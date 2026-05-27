---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Canonical overview for Agentic Memory.
---

# Agentic Memory

Agentic Memory is a simple, local-first memory system for AI agents.

It uses plain Markdown, Obsidian-compatible links, progressive disclosure, and a small filesystem contract so agents can remember useful context without loading an entire vault into the context window.

## Core idea

Agentic Memory is a graph-guided memory system:

- `MEMORY.md` is the lean core memory and root map of content.
- MOCs are routing surfaces that tell agents what to read next.
- Atomic notes are the durable leaf nodes of the knowledge graph.
- Sources are immutable evidence.
- Outputs are durable artifacts produced from the memory system.
- Reflection periodically improves the graph using memory health and agent usage patterns.

## Repository layout

```text
docs/                      # human-facing canonical documentation
skills/reflection/         # manual companion skill for graph/session reflection
migrations/                # versioned migration guides and migration skills
templates/vault/           # copyable Agentic Memory v1 vault template
```

## Start here

- [Architecture](docs/architecture.md) — conceptual model and filesystem shape.
- [Schema](docs/schema.md) — required metadata, note roles, budgets, and naming rules.
- [Operating model](docs/operating-model.md) — how agents load, write, and maintain memory.
- [Linking and MOCs](docs/linking-and-mocs.md) — critical routing and semantic-linking rules.
- [Reflection workflow](docs/reflection-workflow.md) — graph health, compaction, and session-feedback loop.
- [Migration](docs/migration.md) — migration philosophy and versioned migration structure.
