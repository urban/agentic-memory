---
version: 0.3.0
---

# Agentic Memory v0.3.0

Vault-local LLM contract. This file may be reached from the vault's root `AGENTS.md` or from an external bootstrap that points at this vault. Do not re-read entrypoint files just to satisfy a load order; continue with progressive disclosure.

If a global bootstrap is active while the current working directory is this vault, the vault-local entry point is authoritative and the bootstrap is redundant.

## Startup after this file

1. Read `MEMORY.md`.
2. Read `USER.md`.
3. Read routed instruction files only when the task needs them.
4. Load the relevant map/project, then specific notes/people/records/sources only as needed.

Never load whole folders by default.

## Required shape

Root: `AGENTS.md`, `MEMORY.md`, `USER.md`, `.agentic-memory/`, `maps/`, `projects/`, `notes/`, `people/`, `sources/`, `records/`.

Control plane: `.agentic-memory/LLMS.md`, `instructions/{writing-memory,linking-and-maps,cross-project-persistence,reflection}.md`, `templates/{map,project,note,person,record,reflection-record,source,user}.md`.

## Roles

- `MEMORY.md` / `type: core`: lean root map and top-level project routes.
- `USER.md` / `type: user`: lean owner context; link to detailed user-pattern notes.
- `maps/` / `type: map`: high-level domain/concept framing and routing.
- `projects/` / `type: project`: recurring-effort state, decisions, open loops, and routing.
- `notes/` / `type: note`: one reusable idea, pattern, preference, decision, question, or concept.
- `people/` / `type: person`: useful non-sensitive context about people other than the owner.
- `sources/` / `type: source`: immutable evidence.
- `records/` / `type: record`: compact dated recall summaries.
- `.agentic-memory/`: control plane; edit only when changing agent behavior.

## Instruction routing

- `instructions/writing-memory.md`: read before creating/editing memory content.
- `instructions/linking-and-maps.md`: read before adding routes, semantic links, maps, or project navigation.
- `instructions/cross-project-persistence.md`: read when this vault is secondary memory for another project.
- `instructions/reflection.md`: read when maintaining graph health, compacting, or reviewing promotion.

## Non-negotiables

- Current task first; memory persistence second.
- Use progressive disclosure and smallest useful edits.
- Persist only durable, high-signal context; skip facts cheaply re-read from project files.
- Keep `MEMORY.md` and `USER.md` lean and pointer-heavy.
- Keep sources, synthesis, project state, and dated records distinct.
- Promote repeated project observations into `notes/` or `USER.md`; link projects to the source of truth.
- Use vault-root-relative wikilinks: `[[USER]]`, `[[maps/name]]`, `[[projects/name]]`, `[[notes/name]]`, `[[people/name]]`, `[[sources/name]]`, `[[records/name]]`.
- Preserve human authorship/intent. Label uncertainty and user observations as Explicit, Repeated, Observed, or Inferred when confidence matters.
- Do not infer sensitive traits or private facts without explicit evidence.
- Do not commit automatically.

Close substantial work by identifying the relevant project/candidate, making the smallest useful memory update, checking routes/dates, and summarizing Git status when practical.
