# Memory Adapter

`MEMORY_ADAPTER.md` is a copyable router snippet for connecting agents outside an Agentic Memory vault to that vault as persistent secondary memory. In this repository it lives at `template/.agentic-memory/adapters/MEMORY_ADAPTER.md`; after initializing a vault it lives at `.agentic-memory/adapters/MEMORY_ADAPTER.md` inside that vault.

The adapter does not teach the whole memory system. It only decides which mode applies and points the agent to the correct LLM contract.

## Two modes

- **Vault-local memory** starts when the current working directory itself contains `.agentic-memory/`. The harness should follow that directory's local entry point, normally root `AGENTS.md`, which routes to `.agentic-memory/LLM-vault-local.md`.
- **Outside-vault memory persistence** starts when the current working directory does not contain `.agentic-memory/` and a global or project-level instruction file points at a central Agentic Memory vault by absolute path. The adapter routes directly to `.agentic-memory/LLM-outside-vault.md` in that central vault.

The adapter checks only the current working directory. It does not search ancestor directories.

## When to use it

Install the memory adapter when an agent working outside the vault should be able to read and update durable memory stored in that vault.

Common installation targets:

- user-level `AGENTS.md` / `CLAUDE.md`
- Pi `APPEND_SYSTEM.md`
- repo-level `AGENTS.md` / `CLAUDE.md`
- any custom system-prompt or instruction file supported by a coding-agent harness

You do not need the memory adapter for agents already operating inside the memory vault. In that case, the vault's own `AGENTS.md` is the entry point.

## Setup

1. Open `.agentic-memory/adapters/MEMORY_ADAPTER.md` in the initialized vault.
2. Copy its full contents into the harness-specific entry point.
3. Replace `/absolute/path/to/memory-vault` with the actual Agentic Memory vault path.
4. Keep the adapter short. If it starts repeating rules from `.agentic-memory/instructions/`, replace that detail with a route to the appropriate LLM contract.
5. Review the installed adapter as harness behavior, not ordinary project memory.

## Ownership boundary

A person or setup tool should create and review harness-specific adapter files. Ordinary coding-session agents should not silently create or rewrite files such as `APPEND_SYSTEM.md`, `CLAUDE.md`, or repo-level `AGENTS.md`, because those files change how future sessions are instructed.

## What success looks like

After setup, an external agent can:

1. complete the current project task first
2. notice when the current working directory is already an Agentic Memory vault and stop using the adapter
3. route outside-vault work to the central vault's `.agentic-memory/LLM-outside-vault.md`
4. load the central vault only when memory is useful
5. save only durable, high-signal context at natural stopping points
