# Cross-Project Persistence

Cross-project persistence is the Agentic Memory behavior for agents working outside the memory vault.

The agent's primary responsibility is the current task in the current project. Its secondary responsibility is to preserve durable, high-signal memory that will help future sessions and future projects.

## Purpose

Most agent sessions are project-oriented. A session should usually correspond to:

- an existing project in `projects/`
- an umbrella project that routes several subprojects
- a project candidate that may become durable after repeated sessions

Project memory helps the agent resume work without storing full chat logs or re-reading unnecessary source files. The best memory eventually transcends a single project and becomes reusable atomic knowledge.

## What belongs in project memory

Project files should capture high-level information that is not cheaply derived from source files:

- purpose, goals, and objectives
- durable current state
- key decisions and rationale
- open questions and unresolved tradeoffs
- next useful context for future sessions
- routing to records, notes, maps, sources, people, repos, or subprojects
- user observations that arose in the project and may matter elsewhere

Do not store routine implementation facts, source-code summaries, or file details that future agents can cheaply re-read from the repository.

## User observations

Some project observations are really about the user of the memory system:

- how the user communicates
- what certain phrases mean to the user
- how the user likes responses formatted
- prompting and LLM workflow patterns
- repeated tech-selection rationale
- recurring decision heuristics

Store compact stable user context in `USER.md`. If the pattern needs detail, evidence, or semantic links, create or update an atomic note in `notes/` and link to it from `USER.md` and relevant project files.

Use confidence labels:

- **Explicit** — the user stated it directly.
- **Repeated** — observed across projects or many sessions.
- **Observed** — observed in one project or a small number of sessions.
- **Inferred** — plausible but lower-confidence; verify before relying on it.

## Promotion into reusable memory

Project files are staging areas for discoveries. They should not become the permanent home for patterns that apply across projects.

Promote project-specific observations into `notes/` or `USER.md` when they are:

- repeated across two or more projects or many sessions
- useful for future decisions beyond the source project
- not cheaply re-derived from current project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or explicitly marked as inferred / lower-confidence
- better represented once than duplicated in many project files

After promotion:

1. create or update the atomic note or `USER.md` entry
2. link originating project files to the new source of truth
3. remove or compact duplicate project-local wording when safe
4. preserve dated history in `records/` if the evolution matters

## Projects versus maps

Use `projects/` when the file tracks an effort's state, goals, decisions, and open loops.

Use `maps/` when the file frames a domain or category and routes to supporting projects, notes, records, people, or sources.

An umbrella effort can start as a project when it has active state. Later, if its main value becomes organizing a reusable domain, create or update a memory map and leave the completed/archived project as historical state.

## Session close behavior

At natural stopping points, agents should proactively evaluate what future sessions need to remember and make the smallest useful memory update without requiring explicit prompting.

Typical updates:

- update an existing project file's current state or open questions
- create a project candidate when repeated work suggests a recurring effort
- add a compact record for meaningful work, decisions, or handoff context
- update `USER.md` for stable owner facts or communication preferences
- promote repeated patterns into atomic notes
- update maps when routing changes

Do not derail the current task for memory maintenance. Prefer small, reviewable, Git-auditable edits.
