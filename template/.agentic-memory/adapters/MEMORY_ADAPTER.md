# Agentic Memory Adapter

This file is a copyable instruction snippet for connecting agents outside an Agentic Memory vault to that vault as persistent secondary memory.

Central Agentic Memory vault:

`/absolute/path/to/memory-vault`

Copy/adapt this snippet into a global or project-level agent instruction file such as user-level `AGENTS.md`, `CLAUDE.md`, Pi `APPEND_SYSTEM.md`, or a harness-specific equivalent.

If the current working directory is the central vault itself, follow the vault's local `AGENTS.md` entry point and treat this adapter as redundant.

Priorities:

1. Follow current project/vault instructions and complete the current task.
2. Use the central vault as secondary memory only when durable context will help future sessions or future projects.

Startup, when memory is useful and the current working directory is outside the central vault:

1. Read `AGENTS.md` in the central vault.
2. Read `.agentic-memory/LLMS.md` in the central vault.
3. Read `MEMORY.md` and `USER.md` in the central vault.
4. For cross-project memory updates, read `.agentic-memory/instructions/cross-project-persistence.md` in the central vault.
5. Load only relevant maps, projects, notes, people, records, or sources.

Rules:

- Use progressive disclosure; do not load the whole vault.
- Identify the relevant project, umbrella project, or project candidate before saving memory.
- Store project state in `projects/`, reusable patterns in `notes/`, owner context in `USER.md`, evidence in `sources/`, and dated summaries in `records/`.
- Do not store facts that can be cheaply re-read from the current project files.
- Do not commit automatically.
