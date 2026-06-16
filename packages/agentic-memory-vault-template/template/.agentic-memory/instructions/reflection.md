# Reflection

Maintenance workflow for graph health, compaction, promotion review, and cleanup proposals.

Use `writing-memory.md` for persistence/promotion rules and `linking-and-maps.md` for navigation rules.

## Inspect

- Git status/diffs
- `MEMORY.md`: budget, top-level routes, project routes
- `USER.md`: budget, confidence labels, pointer quality, overconfidence/sensitivity
- maps: purpose, route format, depth, content-dump risk
- projects: `project_status`, resume context, project timeline, decision log, next useful context, stale state, duplicated source facts, promotion opportunities
- notes: focus, maturity, semantic links, duplication, orphan status
- people: usefulness, evidence, speculation/sensitivity risk
- records/sources: boundaries, sizes, provenance
- optional external session summaries, if provided

Never copy raw session logs into the vault.

## Safe direct edits

Allowed: normalize frontmatter/summaries/routes/link scaffolds, mark stale/uncertain memory, add needed confidence labels, update `updated`, and create a Reflection record.

Ask before high-impact changes: deletion, pruning, archiving, splitting, merging, materially rewriting `MEMORY.md`/`USER.md`/projects/human meaning, changing schema/instructions, or major lift/decompose work.

## Flag

- missing `project_status`, `Resume context`, `Project timeline`, `Decision log`, or next useful context
- project task logs/source-code summaries/reusable insights that belong elsewhere
- bulky, duplicated, overconfident, speculative, or unlabeled `USER.md` entries
- maps that duplicate notes/projects instead of routing
- overloaded/duplicated/weakly linked notes
- people notes for incidental names or sensitive speculation

## Promotion / decomposition plan

Before material movement, propose: source text, destination file(s), links/routes to update, wording to keep/compact/archive/delete, and risks/uncertainty. Proceed only after approval when meaning or structure changes materially.

## Reflection record

For substantial runs create `records/YYYY-MM-DD-reflection.md` with context inspected, changes made, rationale, proposed-but-not-made changes, usage/promotion patterns, open questions, and Git status/diff summary.

## Closeout

Summarize what changed and why, relevant diffs, proposed follow-ups, optional commit message, and Git status. Do not commit automatically.
