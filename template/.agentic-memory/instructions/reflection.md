# Reflection

Reflection is the maintenance workflow for graph health, compaction, promotion, and usage-pattern learning.

## Inspect

- Git status and relevant diffs
- `MEMORY.md` budget and routing quality
- `USER.md` budget, confidence labeling, and pointer quality
- memory-map framing, routing-link format, and map depth
- project lifecycle state, project routing, and project-to-note promotion opportunities
- atomic-note semantic links and maturity
- orphan or weakly connected notes
- people-note quality, missing durable people context, and speculative people context
- stale or duplicated memory
- record quality and size
- optional external session traces, if provided

## Do not store raw session logs

Session traces are external. Do not copy raw session logs into the vault.

If a durable summary of session usage is worth preserving as evidence, save a compact source in `sources/`.

## Safe edits

Allowed directly:

- add missing frontmatter or summaries to managed memory files
- normalize Obsidian-compatible frontmatter formatting
- normalize memory-map and project routing links
- add semantic-link scaffolds
- mark graph debt
- add missing confidence labels to clearly agent-inferred user observations
- update `updated` dates
- create Reflection record

Ask before:

- deleting, pruning, or archiving notes
- deleting, pruning, or archiving people notes
- deleting, pruning, or archiving projects
- materially rewriting `MEMORY.md` or `USER.md`
- splitting or merging notes
- changing schema or instructions
- altering human-authored meaning
- lifting and decomposing an overloaded note or project into a map plus multiple notes/projects

## Project review

Project files should capture durable effort state and routing, not full histories or facts that can be cheaply re-read from source files.

Flag project files that:

- lack `project_status`
- do not identify current state or next useful context
- duplicate implementation facts from source files
- contain dated work history that belongs in `records/`
- contain cross-project insights that should be promoted into `notes/` or `USER.md`
- act more like a conceptual/domain map than an effort with lifecycle state

A group of projects should become or link to a memory map when the main value is domain framing rather than project-state tracking.

## User-memory review

`USER.md` should be lean, pointer-heavy, and careful about confidence.

Flag `USER.md` when it:

- grows beyond budget
- stores detailed patterns that should be atomic notes
- duplicates project-local wording
- includes inferred preferences without confidence labels
- overstates a one-off observation as a stable preference
- contains sensitive or private speculation

Use confidence labels such as `Explicit`, `Repeated`, `Observed`, and `Inferred`.

## People-note review

Create or propose people notes only for people other than the vault owner who are meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

Do not create people notes for every name found in text. Incidental names in raw sources, citations, competitor pages, articles, or historical captures should not become `people/` notes unless directly useful for future work.

Flag people notes that are speculative, sensitive, duplicated, stale, or too detailed for durable memory.

## Promotion review

Promote an observation into an atomic note or `USER.md` when it is:

- repeated across two or more projects or many sessions
- useful for future decisions beyond the source project
- not cheaply re-derived from current project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or clearly marked as inferred / lower-confidence
- better represented once than duplicated in many project files

Before substantial promotion, propose:

1. the project-local observation to promote
2. the destination (`notes/` or `USER.md`)
3. the new or existing source-of-truth file
4. links to update in originating project files
5. what wording should remain in the project after compaction

Small, obvious link updates may be made directly. Material rewrites of human-authored project or user memory require approval.

## Lift + decompose

Use lift + decompose when an atomic note or project:

- contains multiple reusable ideas
- exceeds token budget
- has too many semantic directions
- is repeatedly loaded for only one section
- acts more like a map or overview than one idea/effort
- has multiple child ideas or subprojects that deserve their own files

This is a high-impact refactor and requires approval.

Before making changes, propose:

1. the overloaded note or project to refactor
2. the new memory map name, if any
3. the new atomic notes or projects to extract
4. how links and parent maps/projects should change
5. what happens to the original file after approval

After approval:

- create the map and extracted notes/projects
- update semantic links
- update parent maps, projects, or `MEMORY.md` if needed
- archive, delete, or convert the original according to the approved plan

## Draft and deletion policy

Draft notes and project candidates can be promoted, merged, archived, or deleted. Archive files when retained historical context is useful. Delete only when a file is low-value, duplicated, noisy, or no longer useful after review.

Deletion requires explicit human approval.

## Reflection record

For every substantial Reflection run, create:

```text
records/YYYY-MM-DD-reflection.md
```

Include:

- context available
- what was inspected
- changes made
- why changes were made
- changes proposed but not made
- usage patterns observed
- promotion opportunities observed
- open follow-up questions
- Git status and diff summary

The Reflection record is a time-bound rationale record, not canonical policy.

## Closeout

- Show what changed and why.
- Show `git status`.
- Summarize relevant diffs when useful.
- Suggest a commit message if helpful.
- Do not commit automatically.
