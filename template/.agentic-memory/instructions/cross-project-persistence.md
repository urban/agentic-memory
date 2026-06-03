# Cross-Project Persistence

Read when an agent is working outside this vault and using the vault as secondary durable memory.

This file is the external-session delta. For canonical persistence, layer choice, promotion criteria, confidence labels, and frontmatter rules, read `.agentic-memory/instructions/writing-memory.md`. For link and routing formats, read `.agentic-memory/instructions/linking-and-maps.md`.

## Priorities

1. Complete the current task in the current project.
2. Preserve durable, high-signal memory only when it will help future sessions or future projects.

Do not derail the current task. Persist at natural stopping points.

## Startup

When memory is useful:

1. Read `AGENTS.md`, `.agentic-memory/LLMS.md`, `MEMORY.md`, and `USER.md`.
2. Identify the relevant `projects/` file, umbrella project, or project candidate.
3. Load only the specific map, project, note, record, person, or source needed.

Do not load entire folders.

## Session-to-project association

Each substantial session should usually correspond to an existing project, an umbrella project, or a project candidate. Create a candidate only when the effort appears durable or likely to recur; one-off tasks usually do not need project files.

## What to capture

Prefer project/user context that is not cheaply re-read from the current repo:

- goals, current durable state, decisions, rationale, open loops, and next useful context
- repeated user communication, prompting, workflow, or tech-selection patterns
- compact records for meaningful work, decisions, or handoffs
- sources only when evidence needs to be preserved

Skip routine implementation facts, file lists, chatty updates, raw logs, duplicate summaries, and one-off observations framed as stable preferences.

## Where to save

Use the canonical layer chooser in `writing-memory.md`:

- `projects/` for recurring effort state and project-specific routing
- `USER.md` for lean owner context and pointers to user-pattern notes
- `notes/` for reusable cross-project ideas, preferences, workflows, and decision heuristics
- `records/` for dated summaries
- `sources/` for immutable evidence
- `maps/` for high-level domain/category framing supported by notes and projects

## Closeout checklist

Before ending substantial work:

- Which project or project candidate did this session belong to?
- Does that project need a small state, decision, open-question, or route update?
- Did the session reveal a user observation for `USER.md`?
- Did a repeated pattern meet promotion criteria for an atomic note?
- Is a compact record or source capture warranted?
- Did routing change?
- What does `git status --short` show, if practical?

Every persisted sentence should earn its future token cost.
