# Cross-Project Persistence

Delta for agents working outside this vault while using it as secondary durable memory.

## Priority

1. Finish the current project task.
2. Persist only durable memory that will help future sessions/projects.

Do not derail the task. Save at natural stopping points.

## Startup when memory is useful

Read `MEMORY.md` and `USER.md` if they are not already loaded.

1. Identify the relevant project, umbrella project, or candidate.
2. Load only needed maps/projects/notes/people/records/sources.

For write policy use `writing-memory.md`; for route/link syntax use `linking-and-maps.md`.

## Capture

Prefer context not cheaply re-read from the current repo: goals, durable state, decisions/rationale, open loops, next context, repeated user/workflow/tech-selection patterns, compact handoff/work records, and evidence worth preserving.

Skip routine implementation facts, file lists, task logs, raw chat logs, duplicate summaries, and one-off observations framed as stable preferences.

If you are invoked in Memory Steward capture mode with a structured Capture Payload, read `session-capture.md` before making any durable edits. In that mode, the payload is the authoritative session summary and the scratchpad is temporary local extension state rather than vault content.

## Save location

- `projects/`: recurring-effort state and routing.
- `USER.md`: lean owner context and links to detailed user-pattern notes.
- `notes/`: reusable cross-project ideas, preferences, workflows, heuristics, rationale.
- `records/`: dated summaries.
- `sources/`: immutable evidence.
- `maps/`: high-level reusable domain/category routing.

## Closeout

Ask: Which project/candidate did this belong to? Does it need state, decision, open-loop, route, or next-context updates? Did a user observation or repeated pattern meet capture/promotion criteria? Is a record/source warranted? Did routing change? What does `git status --short` show, if practical?

Every persisted sentence must earn its future token cost.
