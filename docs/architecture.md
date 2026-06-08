# Architecture

Agentic Memory is a small, composable memory system for AI agents.

The architecture optimizes for:

- low context-window cost
- human-readable Markdown
- Obsidian compatibility
- local-first ownership
- graph navigation through memory maps, project memory, and semantic links
- future migration through a stable filesystem and metadata contract

## Two planes

An Agentic Memory vault separates user-visible memory from LLM-facing system files.

### Memory content plane

The content plane contains files a human may browse in Obsidian:

- `MEMORY.md`
- `USER.md`
- `maps/`
- `projects/`
- `notes/`
- `people/`
- `sources/`
- `records/`

### LLM control plane

The control plane lives in a hidden folder:

```text
.agentic-memory/
├── LLM-vault-local.md
├── LLM-outside-vault.md
├── adapters/
│   └── MEMORY_ADAPTER.md
├── instructions/
│   ├── writing-memory.md
│   ├── linking-and-maps.md
│   ├── cross-project-persistence.md
│   ├── session-capture.md
│   └── reflection.md
└── templates/
    ├── map.md
    ├── project.md
    ├── note.md
    ├── person.md
    ├── record.md
    ├── reflection-record.md
    ├── source.md
    └── user.md
```

The control plane stores mode-specific LLM contracts with the local version, version-specific agent instructions, scaffolds agents can use when creating new memory files, and adapter snippets humans can copy into harness-specific entry points such as Pi `APPEND_SYSTEM.md`, user-level `AGENTS.md` / `CLAUDE.md`, or repo-level `AGENTS.md` / `CLAUDE.md`.

## Agent entry points

Agentic Memory has two supported agent entry points.

1. **Vault-local entry point** — used when the current working directory is the root of an initialized Agentic Memory vault. The harness reads the root `AGENTS.md`; that file routes to `.agentic-memory/LLM-vault-local.md`; the vault-local contract then routes content loading.
2. **Outside-vault memory adapter entry point** — used when an agent is working outside the vault but should persist durable information to a central vault. A global or project-level adapter copied from `.agentic-memory/adapters/MEMORY_ADAPTER.md` checks whether the current working directory contains `.agentic-memory/`; if not, it routes directly to the central vault's `.agentic-memory/LLM-outside-vault.md` and keeps the current project task primary.

If both entry points are visible because a global memory adapter is active while the current working directory contains `.agentic-memory/`, the vault-local entry point wins. The adapter is redundant in that context and should not create a second cross-project memory flow.

## Core model

Agentic Memory has eight practical content parts plus one local capture-state surface:

1. **Core memory** — `MEMORY.md`
   - Always-loaded summary and root memory map.
   - Contains high-signal context and links to top-level memory maps and active projects.
   - Must stay small.

2. **User memory** — `USER.md`
   - Always-loaded, lean context about the vault owner / primary user.
   - Captures stable facts, long-lived preferences, user-specific terms, communication preferences, and carefully labeled inferred preferences.
   - Should be pointer-heavy: detailed reusable patterns belong in atomic notes linked from `USER.md`.

3. **Memory maps** — `maps/*.md`
   - High-level conceptual or domain framing notes that route agents to relevant context.
   - They explain why a cluster of notes, projects, people, records, or sources belongs together.
   - They are not content dumps and do not track project lifecycle state.

4. **Projects** — `projects/*.md`
   - Durable state and routing for recurring efforts, including candidates, active projects, completed projects, archived projects, and umbrella efforts.
   - A project is like a project-specific memory map plus resume context, goals, dated timeline, decisions, open questions, and next useful context.
   - Project files should not duplicate facts that can be cheaply re-read from source code or project files.
   - Project files should keep `## Resume context`, `## Project timeline`, and `## Decision log` current without turning into task trackers.

5. **Atomic notes** — `notes/*.md`
   - The smallest durable knowledge units.
   - Each note captures one reusable idea, decision, pattern, question, preference, or concept.
   - Notes mature from `seedling` to `budding` to `evergreen`.

6. **People** — `people/*.md`
   - Durable context about specific people other than the vault owner.
   - People notes are not atomic idea notes; they capture relationships, preferences, associations, and stable facts that help future collaboration.
   - Create them only for people who are meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

7. **Sources** — `sources/*.md`
   - Immutable captured evidence.
   - Raw source material or source-like records.
   - Not loaded by default.

8. **Records** — `records/*.md`
   - Compact recall summaries of work, decisions, handoffs, migrations, sessions, or Reflection runs.
   - Records describe what happened, why, how, and what mattered.
   - They do not store full artifacts by default.

9. **Capture scratchpad** — `.pi/agentic-memory-capture/`
   - Local extension state used by outside-vault capture flows.
   - Carries weak signals and candidate promotions between capture passes.
   - Not part of vault memory content and not loaded as normal memory.

## Required vault layout

```text
memory/
├── AGENTS.md
├── MEMORY.md
├── USER.md
├── .agentic-memory/
│   ├── LLM-vault-local.md
│   ├── LLM-outside-vault.md
│   ├── adapters/
│   │   └── MEMORY_ADAPTER.md
│   ├── instructions/
│   │   ├── writing-memory.md
│   │   ├── linking-and-maps.md
│   │   ├── cross-project-persistence.md
│   │   ├── session-capture.md
│   │   └── reflection.md
│   └── templates/
│       ├── map.md
│       ├── project.md
│       ├── note.md
│       ├── person.md
│       ├── record.md
│       ├── reflection-record.md
│       ├── source.md
│       └── user.md
├── maps/
├── projects/
├── notes/
├── people/
├── sources/
└── records/
```

Content folders are flat by default. Use memory maps, project links, and semantic links for structure instead of deep folder hierarchy.

`template/` starts with empty `maps/`, `projects/`, `notes/`, `people/`, `sources/`, and `records/` folders plus a scaffolded `USER.md`. See `examples/basic/` for reference content.

## Progressive disclosure

Entrypoint resolution happens before content loading. Once an agent has reached the appropriate LLM contract file (`.agentic-memory/LLM-vault-local.md` or `.agentic-memory/LLM-outside-vault.md`), it should load memory in this order:

1. `MEMORY.md`
2. `USER.md`
3. optional instruction files routed from the active LLM contract
4. relevant memory map or project file
5. specific atomic notes, people notes, or related projects
6. records, only when needed
7. sources, only for verification or ingestion

The system should make it possible to answer most routing questions from `MEMORY.md`, `USER.md`, and one relevant memory map or project file.

## Navigation shape

- `MEMORY.md` is the root memory map and contains a dedicated Projects section.
- `USER.md` is root-level owner context and should link to detailed atomic notes when user patterns need more space.
- `maps/` contains high-level domain or concept maps.
- `projects/` contains durable effort-specific state and routing.
- Atomic notes are focused knowledge units that agents load after following routing links.
- People notes are entity notes for meaningful human collaborators or recurring contacts other than the vault owner.
- Atomic notes and project files connect to related memory using semantic links.
- Sources and records are referenced by notes, people notes, project files, and maps but are not default context.

Memory maps may reference other memory maps and projects, but depth should remain shallow:

- preferred: `MEMORY.md → map/project → note`
- acceptable: `MEMORY.md → map → map/project → note`
- depth 3 map chains are allowed only for large domains and should be reviewed
- depth greater than 3 requires an explicit local deviation in `.agentic-memory/LLM-vault-local.md`

## Project memory and promotion

Project memory is a staging layer for durable context discovered during work. The most valuable memory often transcends one project: repeated user preferences, repeated technical rationale, reusable workflows, and durable decision heuristics should be promoted into atomic notes or `USER.md` and linked from the originating projects.

Promotion keeps project files concise and makes atomic notes the single source of truth for reusable knowledge.

`## Resume context` should answer "what does the next session need before resuming?" `## Project timeline` should capture only meaningful dated milestones. `## Decision log` should preserve consequential decisions with concise rationale. If the durable history becomes dense, prefer a linked `records/` entry over expanding the project file into a running activity log.

## Design constraints

- Keep the system simple enough to migrate.
- Prefer links over categories.
- Prefer frontmatter over hidden tool state for managed memory files.
- Prefer small files over sprawling notes.
- Prefer Reflection and compaction over endless accumulation.
- Preserve the distinction between content memory and LLM control-plane instructions.
- Do not store facts in memory when they can be cheaply re-read from the current project files.
