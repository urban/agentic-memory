# Reflection

Reflection is the maintenance workflow for graph health, compaction, and usage-pattern learning.

## Inspect

- Git status and relevant diffs
- `MEMORY.md` budget and routing quality
- memory-map routing-link format
- map depth and top-level map quality
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
- normalize memory-map routing links
- add semantic-link scaffolds
- mark graph debt
- update `updated` dates
- create Reflection record

Ask before:

- deleting, pruning, or archiving notes
- deleting, pruning, or archiving people notes
- materially rewriting `MEMORY.md`
- splitting or merging notes
- changing schema or instructions
- altering human-authored meaning
- lifting and decomposing an overloaded note into a map plus multiple notes

## People-note review

Create or propose people notes only for people who are meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

Do not create people notes for every name found in text. Incidental names in raw sources, citations, competitor pages, articles, or historical captures should not become `people/` notes unless directly useful for future work.

Flag people notes that are speculative, sensitive, duplicated, stale, or too detailed for durable memory.

## Lift + decompose

Use lift + decompose when an atomic note:

- contains multiple reusable ideas
- exceeds token budget
- has too many semantic directions
- is repeatedly loaded for only one section
- acts more like a map or overview than one idea
- has multiple child ideas that deserve their own notes

This is a high-impact refactor and requires approval.

Before making changes, propose:

1. the overloaded note to refactor
2. the new memory map name, if any
3. the new atomic notes to extract
4. how links and parent maps should change
5. what happens to the original note after approval

After approval:

- create the map and extracted notes
- update semantic links
- update parent maps or `MEMORY.md` if needed
- archive, delete, or convert the original according to the approved plan

## Draft and deletion policy

Draft notes can be promoted, merged, archived, or deleted. Archive notes when retained historical context is useful. Delete only when a note is low-value, duplicated, noisy, or no longer useful after review.

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
- open follow-up questions
- Git status and diff summary

The Reflection record is a time-bound rationale record, not canonical policy.

## Closeout

- Show what changed and why.
- Show `git status`.
- Summarize relevant diffs when useful.
- Suggest a commit message if helpful.
- Do not commit automatically.
