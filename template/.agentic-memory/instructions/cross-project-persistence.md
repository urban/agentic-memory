# Cross-Project Persistence

Read this file when an agent is working outside this memory vault and using the vault as durable cross-project memory.

## Priorities

1. Complete the current task in the current project.
2. Preserve high-signal durable context that will help future sessions or future projects.

Do not derail the current task for memory maintenance. Persist only at natural stopping points or when a durable finding is clearly worth saving.

## Startup orientation

When useful for the task:

1. Read `AGENTS.md`.
2. Read `.agentic-memory/LLMS.md`.
3. Read `MEMORY.md`.
4. Read `USER.md`.
5. Identify the relevant existing project, umbrella project, or project candidate.
6. Load only the relevant project, map, note, person, record, or source files.

Do not load entire folders by default.

## Session-to-project association

Each meaningful agent session should usually correspond to one of:

- an existing project in `projects/`
- an umbrella project that routes several subprojects
- a project candidate that may become durable after repeated observed work

Create a project candidate only when the work appears likely to recur or when preserving the effort would help future sessions. One-off tasks usually do not need project files.

## What to persist

Persist high-signal context such as:

- stable user preferences
- project goals, objectives, and current state
- decisions and rationale not obvious from source files
- reusable workflows
- important open questions
- source-grounded synthesis
- repeated prompting, communication, or technical-decision patterns
- compact records of meaningful work or handoffs

Do not persist:

- chatty updates
- temporary brainstorm noise
- raw session logs
- duplicate summaries
- facts that can be cheaply re-read from current repo files
- full artifacts by default
- one-off observations presented as stable preferences

## Where to persist

Use the smallest correct memory layer:

- `MEMORY.md` — root routes and active/important project links.
- `USER.md` — lean stable owner facts, communication preferences, glossary meanings, and inferred preferences.
- `projects/` — recurring effort state, goals, decisions, open loops, and project-specific routing.
- `maps/` — high-level domain or concept framing supported by notes and projects.
- `notes/` — atomic reusable ideas, preferences, workflows, decision heuristics, and cross-project patterns.
- `people/` — durable context about specific people other than the vault owner.
- `records/` — compact dated work, decision, handoff, migration, session, or Reflection summaries.
- `sources/` — immutable evidence or captured source material.

## Project memory rules

Project files are project-specific memory maps plus state.

Capture:

- purpose and goals
- current durable state
- key decisions and rationale
- open questions and tradeoffs
- next useful context
- routing to notes, maps, records, sources, people, repos, and subprojects

Avoid:

- source-code summaries
- file listings
- task-by-task logs
- duplicated cross-project patterns
- facts that are cheap to re-derive from the current project files

Dated session/work history belongs in `records/`, not in the project file body.

## User observation rules

Some project observations are really about the vault owner / primary user.

Capture compactly in `USER.md` or as atomic notes when they concern:

- how the user communicates
- what user-specific phrases mean
- preferred response formats
- prompting and LLM workflow patterns
- repeated tech-selection rationale
- recurring decision heuristics

Use confidence labels:

- `Explicit` — the user stated it directly.
- `Repeated` — observed across projects or many sessions.
- `Observed` — observed in one project or a small number of sessions.
- `Inferred` — plausible but lower-confidence; verify before relying on it.

Do not infer sensitive traits or private facts without explicit evidence.

## Promotion and DRY memory

Project memory is a staging layer. The most valuable memory often transcends projects.

Promote a project-local observation into `notes/` or `USER.md` when it is:

- repeated across two or more projects or many sessions
- useful for future decisions beyond the source project
- not cheaply re-derived from current project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or clearly marked as inferred / lower-confidence
- better represented once than duplicated in many project files

After promotion:

1. create or update the atomic note or `USER.md` entry
2. link originating project files to the source of truth
3. compact duplicate project-local wording when safe
4. preserve dated evolution in `records/` when timing/rationale matters

## Maps and project groups

Use `maps/` for high-level concepts, categories, or domains supported by atomic notes and projects.

Use `projects/` when the file owns project lifecycle state.

If an umbrella project stops needing active state and becomes mainly a domain route across projects and notes, create or update a memory map and route from the completed/archived project to that map.

## Closing habit

Before ending substantial work:

- identify which project this session belonged to
- decide whether the project file needs a small update
- decide whether a compact `records/` summary is warranted
- decide whether a user observation belongs in `USER.md`
- decide whether a repeated pattern should become an atomic note
- update maps or routes only when navigation changed
- check Git status when practical

Every persisted sentence should earn its future token cost.
