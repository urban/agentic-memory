---
version: 0.4.0
---

# Agentic Memory

Resolve all relative paths below against the Central Agentic Memory vault that contains this file. Do not read the Central Agentic Memory vault's root `AGENTS.md`; that entry point is only for vault-local work.

## Startup after this file, when memory is useful

1. Read `MEMORY.md`.
2. Read `USER.md`.
3. Read `instructions/cross-project-persistence.md` before making cross-project memory updates.
4. Read `instructions/writing-memory.md` before creating/editing memory content.
5. Read `instructions/linking-and-maps.md` before adding routes, semantic links, maps, or project navigation.
6. Load only the relevant map/project, then specific notes/people/records/sources as needed.

Never load whole folders by default.

## Memory Steward capture mode

When the prompt explicitly says you are running in Memory Steward capture mode and includes a structured Capture Payload, read `instructions/session-capture.md` before editing memory. In that mode:

- the Capture Payload is the authoritative session boundary
- the local scratchpad is temporary extension state, not vault content by itself
- project files should favor resume context, project timeline, and decision log updates over task-log accumulation
- you must return strict JSON only matching the Capture Result schema

## Secondary-memory stance

- Finish the current project task first.
- Persist only durable, high-signal context likely to help future sessions/projects.
- Do not store facts that can be cheaply re-read from the current project files.
- Prefer natural stopping points for memory updates.
- Do not commit automatically.

## Where durable memory goes

- `MEMORY.md`: lean root routes and cross-cutting core memory.
- `USER.md`: lean owner context, preferences, glossary terms, and links to detailed user-pattern notes.
- `projects/`: recurring-effort state, decisions, open loops, next context, and routing.
- `notes/`: reusable ideas, patterns, preferences, heuristics, rationale, or durable questions.
- `people/`: useful non-sensitive context about people other than the owner.
- `records/`: compact dated summaries of work, migrations, decisions, handoffs, or sessions.
- `sources/`: immutable evidence.
- `maps/`: high-level reusable domain/category routing.

## Cross-project closeout

Before ending substantial work, ask what future sessions should remember. Identify the relevant project, umbrella project, or project candidate before saving memory. Promote repeated project observations into `notes/` or `USER.md` when they become reusable beyond one project. Preserve uncertainty and source boundaries.
