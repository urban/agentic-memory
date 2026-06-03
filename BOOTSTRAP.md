# Cross-Project Agentic Memory Persistence

Central Agentic Memory vault:

`/absolute/path/to/memory-vault`

Use this snippet to attach the current harness to that central vault from another repo.

If the current working directory is the central vault itself, follow the vault's local `AGENTS.md` entry point and treat this bootstrap as redundant.

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
