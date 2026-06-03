# Reflection

Reflection is the maintenance workflow for graph health, compaction, promotion review, and cleanup proposals.

Use `.agentic-memory/instructions/writing-memory.md` as the canonical persistence and promotion policy. Use `.agentic-memory/instructions/linking-and-maps.md` as the canonical navigation policy.

## Inspect

- Git status and relevant diffs
- `MEMORY.md` routes and budget
- `USER.md` budget, confidence labels, and pointer quality
- map framing, route format, and map depth
- project lifecycle state, routing, stale state, and promotion opportunities
- atomic-note focus, semantic links, maturity, duplication, and orphan status
- people-note usefulness and speculation risk
- record/source boundaries and file sizes
- optional external session summaries, if provided

Do not copy raw session logs into the vault. Save compact session evidence in `sources/` only when useful.

## Safe direct edits

Allowed directly:

- normalize managed frontmatter and summaries
- normalize route links and semantic-link scaffolds
- mark graph debt or stale/uncertain memory visibly
- add confidence labels to clearly inferred user observations
- update `updated` dates
- create a Reflection record

Ask before high-impact changes:

- deleting, pruning, archiving, splitting, or merging files
- materially rewriting `MEMORY.md`, `USER.md`, projects, or human-authored meaning
- changing schema or instructions
- lifting/decomposing overloaded notes or projects

## Review focus

Flag:

- project files missing `project_status`, current state, or next useful context
- project files that store source-code facts, task logs, or reusable insights that should move to `notes/` or `USER.md`
- `USER.md` entries that are bulky, duplicated, overconfident, sensitive/speculative, or missing confidence labels
- maps that are content dumps instead of high-level framing routes
- notes that are overloaded, duplicated, weakly linked, or not atomic
- people notes for incidental names or speculative/sensitive claims

## Promotion and lift/decompose

For promotion criteria, follow `writing-memory.md`.

Before substantial promotion or decomposition, propose:

1. what should move or split
2. destination file(s)
3. links/routes to update
4. wording to keep, compact, archive, or delete
5. risks or uncertainty

Proceed only after approval when the change alters human-authored meaning or structure materially.

## Reflection record

For substantial Reflection runs, create:

```text
records/YYYY-MM-DD-reflection.md
```

Include context available, what was inspected, changes made, rationale, proposed-but-not-made changes, usage/promotion patterns, open questions, and Git status/diff summary.

## Closeout

Show what changed and why, summarize relevant diffs when useful, suggest a commit message if helpful, and do not commit automatically.
