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

1. **Create your vault.** Copy `template/` to a permanent local folder that you control:

   ```sh
   cp -R template ~/agentic-memory
   cd ~/agentic-memory
   git init
   ```

   Git is optional, but recommended because agents will update plain Markdown and you can review every memory change as a diff.

2. **Add the first routing memory.** Open `MEMORY.md` and add only the top-level context future agents should see early: active projects, major domains, and links to maps or project files you expect to create. Keep this file small.

3. **Add stable owner context.** Open `USER.md` and add durable facts about the vault owner, long-lived preferences, communication style, and glossary terms. Keep transient tasks out of this file.

4. **Start using the vault with an agent.** Pick one of the two supported entry points:
   - **Vault-local use:** start your coding harness with the vault as the current working directory. The harness should read the root `AGENTS.md`, which routes it into `.agentic-memory/LLM-vault-local.md` and then to the right memory files.
   - **Outside-vault use:** copy `.agentic-memory/adapters/MEMORY_ADAPTER.md` from your new vault into the relevant user-level or project-level harness entry point, such as `AGENTS.md`, `CLAUDE.md`, Pi `APPEND_SYSTEM.md`, or another harness-specific instruction file. Replace `/absolute/path/to/memory-vault` with your vault's real absolute path. After that, agents working in other repositories can use the vault for durable memory while keeping the current project instructions primary.

5. **Let memory grow through use.** During work, ask the agent to create or update maps, projects, notes, people, sources, and records only when the information is durable enough to help future sessions. Review the Markdown changes, commit useful memory, and prune or revise anything that should not persist.

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
