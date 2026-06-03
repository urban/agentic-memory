# Agentic Memory

Agentic Memory is a simple, local-first memory system for AI agents.

It uses plain Markdown, Obsidian-compatible links, progressive disclosure, memory maps, semantic links, compact records, and Git-auditable files so agents can remember useful context without loading an entire vault into the context window.

This repository is not itself an Agentic Memory vault. It defines the system and provides a copyable starter vault.

## Core idea

Agentic Memory separates a memory vault into two planes:

- **Memory content**: `MEMORY.md`, `USER.md`, `maps/`, `projects/`, `notes/`, `people/`, `sources/`, and `records/`.
- **LLM control plane**: `.agentic-memory/`, which contains the local version contract, agent instructions, and file templates.

The memory content stays readable in Obsidian. The hidden control plane tells agents how to operate the vault.

## Repository layout

```text
BOOTSTRAP.md               # copy/adapt into harness-specific cross-project entrypoints
docs/                      # human-facing canonical documentation
examples/basic/            # small example memory graph for reference
skills/reflection/         # manual companion skill dispatcher for Reflection
migrations/                # versioned migration guides and migration skills
template/                  # clean Agentic Memory vault template
```

## Starter vault vs examples

`template/` is intentionally clean. Its `maps/`, `projects/`, `notes/`, `people/`, `sources/`, and `records/` folders start empty so a new memory system does not inherit seed content. `USER.md` starts as a lean scaffold for owner-specific memory.

`examples/basic/` contains a small reference content plane showing how user memory, project memory, memory maps, and atomic notes can look. It intentionally omits `.agentic-memory/`; combine it with `template/.agentic-memory/` to make a runnable vault.

## Tooling status

Agentic Memory is intended to have a Bun-powered `agentic-memory` CLI with commands such as `validate` and `init`, but CLI implementation is deferred until after the documentation and template are approved.

## Start here

- [Architecture](docs/architecture.md) — conceptual model and filesystem shape.
- [Schema](docs/schema.md) — required metadata, file roles, budgets, and naming rules.
- [Operating model](docs/operating-model.md) — how agents load, write, and maintain memory.
- [Linking and maps](docs/linking-and-maps.md) — memory-map, project-routing, and semantic-linking rules.
- [Cross-project persistence](docs/cross-project-persistence.md) — proactive project/user memory capture across agent sessions.
- [Bootstrap](docs/bootstrap.md) — how to install `BOOTSTRAP.md` into harness-specific entrypoints.
- [Reflection workflow](docs/reflection-workflow.md) — graph health, compaction, and session-feedback loop.
- [Migration](docs/migration.md) — migration philosophy and versioned migration structure.
