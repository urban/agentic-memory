# Agentic Memory

Agentic Memory is a local-first memory system for AI agents. It gives agents a small, navigable Markdown vault for durable context without forcing them to load an entire note collection into the context window.

This repository is not itself a memory vault. It defines the system, documents the operating model, and provides a clean starter vault under `template/`.

## Why use it

Use Agentic Memory when you want agents to remember useful context across sessions while keeping that memory:

- **plain Markdown** — readable in any editor and friendly to Obsidian
- **local-first and Git-auditable** — owned by the user, reviewable through diffs
- **low-context** — organized for progressive disclosure instead of prompt dumps
- **structured but simple** — maps, projects, notes, people, sources, and records have clear roles
- **portable** — harness-specific instructions can point at the same vault

## How it works

An Agentic Memory vault has two planes:

- **Memory content**: `MEMORY.md`, `USER.md`, `maps/`, `projects/`, `notes/`, `people/`, `sources/`, and `records/`.
- **LLM control plane**: `.agentic-memory/`, which contains mode-specific LLM contracts with the vault version, concise agent instructions, templates, and adapter snippets.

Humans browse and edit the content plane. Agents reach the control plane through one of the entry points below, then load memory in stages: root memory, lean user context, then only the relevant map, project, note, person, record, or source.

## Two agent entry points

Agentic Memory supports two main agent use cases.

### 1. Vault-local memory

Use this when the current working directory is the root of an initialized Agentic Memory vault: it has `.agentic-memory/`, root memory files, content folders, `AGENTS.md`, and `USER.md`.

A coding harness that starts in this directory should automatically read the root `AGENTS.md`. That file is the entry point; it routes the agent to `.agentic-memory/LLM-vault-local.md`, which then routes to `MEMORY.md`, `USER.md`, optional instruction files, and only the relevant memory content. The memory adapter is not needed for this mode.

### 2. Outside-vault memory persistence

Use this when an agent is working outside the Agentic Memory vault but should also preserve durable information in that vault.

After initializing a vault, copy/adapt its `.agentic-memory/adapters/MEMORY_ADAPTER.md` into a harness entry point such as a user-level `AGENTS.md`, `CLAUDE.md`, Pi `APPEND_SYSTEM.md`, or a local project equivalent. The adapter checks whether the current working directory itself contains `.agentic-memory/`; if not, it routes directly to the central vault's `.agentic-memory/LLM-outside-vault.md`, keeps the current project task primary, and uses the vault as secondary memory only when it is useful.

If a global memory adapter is active while the harness starts with a current working directory that contains `.agentic-memory/`, the vault-local entry point wins. The adapter is redundant in that context and should not cause a second cross-project memory flow.

Other patterns, such as Reflection, migration, human browsing in Obsidian, or multiple harnesses sharing one vault, are variants of these two agent entry points rather than separate startup paths.

## Quick start

1. Copy `template/` to the place where you want a new memory vault.
2. Open the new vault's `MEMORY.md` and add only top-level routes that future agents should see early.
3. Open `USER.md` and add stable owner context, preferences, and glossary terms. Keep it lean.
4. Add maps, projects, notes, people, sources, and records as durable memory emerges.
5. For vault-local use, start the coding harness in the initialized vault/repo and let it read root `AGENTS.md`.
6. For outside-vault use, copy/adapt `.agentic-memory/adapters/MEMORY_ADAPTER.md` from the initialized vault into the relevant global or project harness entry point and replace `/absolute/path/to/memory-vault` with the real path.

`template/` is intentionally clean: its content folders start empty and `USER.md` is only a scaffold, so a new vault does not inherit example memory. For a concrete reference graph, inspect `examples/basic/`. The example intentionally omits `.agentic-memory/`; pair it with the template control plane if you want to operate it as a full vault.

## Repository layout

```text
docs/                      # human-facing guides and reference docs
examples/basic/            # small example memory graph
skills/reflection/         # companion skill dispatcher for Reflection
migrations/                # versioned migration guides and migration skills
template/                  # clean copyable Agentic Memory vault
```

## Guides

- [Architecture](docs/architecture.md) — what the vault contains and why the two-plane design exists.
- [Schema](docs/schema.md) — required files, frontmatter, statuses, naming rules, and budgets.
- [Operating model](docs/operating-model.md) — how agents should load, write, promote, and close out memory work.
- [Linking and maps](docs/linking-and-maps.md) — how navigation, memory maps, project routes, and semantic links work.
- [Cross-project persistence](docs/cross-project-persistence.md) — how agents preserve durable memory while working in other repos.
- [Memory adapter](docs/memory-adapter.md) — how to connect outside-vault agents to a central Agentic Memory vault.
- [Reflection workflow](docs/reflection-workflow.md) — maintenance, compaction, graph health, and promotion review.
- [Migration](docs/migration.md) — migration philosophy and versioned migration structure.
