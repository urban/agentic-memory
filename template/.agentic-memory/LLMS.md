---
version: 0.3.0
---

# Agentic Memory LLM Instructions

Local control-plane entrypoint for this vault. Read this file before meaningful vault work, then load only the routed instructions and memory content needed for the task.

## Required structure

```text
AGENTS.md
MEMORY.md
USER.md
.agentic-memory/
├── LLMS.md
├── instructions/
│   ├── writing-memory.md
│   ├── linking-and-maps.md
│   ├── cross-project-persistence.md
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
maps/
projects/
notes/
people/
sources/
records/
```

## Core terms

- `MEMORY.md` (`type: core`) — lean root memory map and top-level routes.
- `USER.md` (`type: user`) — lean owner context and pointers to user-pattern notes.
- `maps/` (`type: map`) — high-level conceptual/domain framing and routing.
- `projects/` (`type: project`) — durable recurring-effort state and project-specific routing.
- `notes/` (`type: note`) — atomic reusable ideas, preferences, patterns, decisions, questions, and concepts.
- `people/` (`type: person`) — durable context about people other than the vault owner.
- `sources/` (`type: source`) — immutable evidence.
- `records/` (`type: record`) — append-stable summaries of work, decisions, sessions, migrations, handoffs, or Reflection.
- `.agentic-memory/` — control plane; edit only when changing how the memory system works.

## Loading order

1. `AGENTS.md`
2. `.agentic-memory/LLMS.md`
3. `MEMORY.md`
4. `USER.md`
5. relevant instruction file below
6. relevant map or project
7. specific notes, people, records, or sources only as needed

Use progressive disclosure. Do not load whole folders by default.

## Instruction routing

- `.agentic-memory/instructions/writing-memory.md` — canonical persistence policy, layer choice, frontmatter, `MEMORY.md`, `USER.md`, projects, promotion, records, sources, people, and file maintenance. Read before creating or editing memory content.
- `.agentic-memory/instructions/linking-and-maps.md` — canonical link formats, map/project routing, semantic links, and map-vs-project boundaries. Read when adding links or navigation.
- `.agentic-memory/instructions/cross-project-persistence.md` — small delta for agents working outside the vault. Read when using this vault as secondary durable memory from another project.
- `.agentic-memory/instructions/reflection.md` — maintenance workflow for graph health, compaction, promotion review, and cleanup proposals. Read when running Reflection.

## Non-negotiables

- Current task first; memory persistence second.
- Persist only high-signal durable context; skip facts cheaply re-read from project files.
- Keep `MEMORY.md` and `USER.md` lean and pointer-heavy.
- Keep source material, synthesis, project state, and dated records distinct.
- Promote repeated project observations into atomic notes or `USER.md`; link projects to the source of truth.
- Use vault-root-relative wikilinks such as `[[USER]]`, `[[maps/name]]`, `[[projects/name]]`, `[[notes/name]]`, `[[people/name]]`, `[[sources/name]]`, and `[[records/name]]`.
- Preserve human authorship and intent; label uncertainty and user observations as explicit, repeated, observed, or inferred when confidence matters.
- Do not infer sensitive traits or private facts without explicit evidence.
- Do not commit automatically.

## Harness bootstrap

Harness-specific entrypoints such as Pi `APPEND_SYSTEM.md`, Claude `CLAUDE.md`, or repo `AGENTS.md` are adapters, not required Agentic Memory content. Use the repository-level `BOOTSTRAP.md` when installing a cross-project bootstrap.

## Session close

Before finishing substantial work, identify the relevant project or project candidate, decide whether durable memory should be saved or promoted, make the smallest useful update, update `updated` dates on material edits, check routes, summarize changes, and check Git status when practical.
