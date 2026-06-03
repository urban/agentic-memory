# Cross-Project Agentic Memory Persistence

Central Agentic Memory vault:

`/absolute/path/to/memory-vault`

Priority:

1. Complete the current task in the current project.
2. Preserve durable memory only when it will help future sessions or future projects.

Startup, when useful:

1. Read `AGENTS.md` in the central vault.
2. Read `.agentic-memory/LLMS.md`.
3. Read `MEMORY.md`.
4. Read `USER.md`.
5. For cross-project memory updates, read `.agentic-memory/instructions/cross-project-persistence.md`.

Rules:

- Use progressive disclosure; do not load the whole vault.
- Identify the relevant project, umbrella project, or project candidate before saving memory.
- Store project state in `projects/`, reusable patterns in `notes/`, owner context in `USER.md`, evidence in `sources/`, and dated summaries in `records/`.
- Do not store facts that can be cheaply re-read from the current project files.
- Do not commit automatically.
