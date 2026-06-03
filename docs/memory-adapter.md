# Memory Adapter

`MEMORY_ADAPTER.md` is a copyable instruction snippet for connecting agents outside an Agentic Memory vault to that vault as persistent secondary memory. In this repository it lives at `template/.agentic-memory/adapters/MEMORY_ADAPTER.md`; after initializing a vault it lives at `.agentic-memory/adapters/MEMORY_ADAPTER.md` inside that vault.

It is different from the vault-local entry point:

- **Vault-local memory** starts when a harness is opened inside an initialized Agentic Memory vault. The harness reads the vault's root `AGENTS.md`, which routes to `.agentic-memory/LLMS.md`.
- **Outside-vault memory persistence** starts when a harness is opened somewhere else and a global or project-level instruction file points at a central Agentic Memory vault by absolute path.

Use the memory adapter only for the second case. It should point the harness to the central vault entry points instead of duplicating the vault's full `.agentic-memory/` control plane.

## When to use it

Install the memory adapter when an agent working outside the vault should be able to read and update durable memory stored in that vault.

Common installation targets:

- user-level `AGENTS.md` / `CLAUDE.md`
- Pi `APPEND_SYSTEM.md`
- repo-level `AGENTS.md` / `CLAUDE.md`
- any custom system-prompt or instruction file supported by a coding-agent harness

You do not need the memory adapter for agents already operating inside the memory vault. In that case, the vault's own `AGENTS.md` is the entry point.

## Global adapter behavior

A global memory adapter may be active in every repo, including the memory vault itself. To avoid confusion:

- local project and vault instructions remain primary for the current task
- the central vault is secondary memory when the current working directory is outside that vault
- if the current working directory is the central vault, follow the vault-local `AGENTS.md` path and treat the adapter as redundant
- do not create a separate project-memory flow merely because the global adapter is present

This makes a global user-level `AGENTS.md`, `CLAUDE.md`, or `APPEND_SYSTEM.md` safe to use alongside a vault-local setup.

## Local project adapter behavior

A repo-level `AGENTS.md` or `CLAUDE.md` can include the memory adapter when the project itself is not an Agentic Memory vault but should persist durable context to one.

In that setup, the project file should keep its normal project instructions and add the adapter as secondary-memory instructions. The current repo's task remains first; memory updates happen at natural stopping points.

## Setup

1. Open `.agentic-memory/adapters/MEMORY_ADAPTER.md` in the initialized vault.
2. Copy its full contents into the harness-specific entry point.
3. Replace `/absolute/path/to/memory-vault` with the actual Agentic Memory vault path.
4. Keep the adapter short. If it starts repeating rules from `.agentic-memory/instructions/`, replace that detail with a route to the vault file.
5. Review the adapter as harness behavior, not ordinary project memory.

## Ownership boundary

A person or setup tool should create and review harness-specific adapter files. Ordinary coding-session agents should not silently create or rewrite files such as `APPEND_SYSTEM.md`, `CLAUDE.md`, or repo-level `AGENTS.md`, because those files change how future sessions are instructed.

## What success looks like

After setup, an external agent can:

1. complete the current project task first
2. load the central vault only when memory is useful
3. read the central vault entry points and core files through progressive disclosure
4. follow `.agentic-memory/instructions/cross-project-persistence.md` for memory updates
5. save only durable, high-signal context at natural stopping points
