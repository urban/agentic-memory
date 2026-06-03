# Bootstrap

`BOOTSTRAP.md` is the human-configured cross-project bootstrap snippet for Agentic Memory.

Use it when connecting an external LLM harness to a central Agentic Memory vault. Examples of harness-specific entrypoints include:

- Pi `APPEND_SYSTEM.md`
- user-level `AGENTS.md` / `CLAUDE.md`
- repo-level `AGENTS.md` / `CLAUDE.md`
- any custom system-prompt or instruction file supported by a coding-agent harness

## How to use it

1. Open `BOOTSTRAP.md`.
2. Copy its full contents into the harness-specific entrypoint.
3. Replace `/absolute/path/to/memory-vault` with the user's actual Agentic Memory vault path.
4. Keep the harness adapter small. It should point the agent to the vault entrypoints, not duplicate the full `.agentic-memory/` instruction set.

## Ownership

The person or setup tooling should create harness-specific adapter files. Ordinary coding-session agents should not silently create or rewrite files such as `APPEND_SYSTEM.md`, `CLAUDE.md`, or repo-level `AGENTS.md`, because those files change harness behavior.
