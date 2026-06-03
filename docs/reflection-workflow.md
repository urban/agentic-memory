# Reflection Workflow

Reflection is the maintenance loop that keeps Agentic Memory useful over time.

It covers what some memory systems call reflection, compaction, dreaming, consolidation, linting, graph health checking, or promotion of repeated observations into reusable memory.

## Purpose

Reflection improves the memory system by inspecting:

1. the memory graph itself
2. agent usage patterns from external session traces, when provided

It should strengthen navigation, reduce context cost, preserve useful rationale, and help the memory system learn from how agents actually use it.

## When to use Reflection

Run Reflection when:

- `MEMORY.md` or maps are getting too large
- agents repeatedly fail to find useful context
- project files are accumulating reusable insights that should be promoted
- `USER.md` is getting bulky, stale, or overconfident
- atomic notes are weakly connected or duplicated
- people notes are missing, noisy, duplicated, or speculative
- many notes are still `draft` or `seedling`
- a session produced durable usage insights
- a migration or major reorganization has just happened
- you want to review memory health before or after meaningful work

## Skill behavior

Reflection is manually triggered through the companion skill at `skills/reflection/SKILL.md`.

The skill is a thin dispatcher. It locates the vault and defers to the local vault instructions at:

```text
.agentic-memory/instructions/reflection.md
```

Those local LLM instructions define the detailed version-specific procedure.

## Session traces

Session data is external to Agentic Memory.

Rules:

- Do not store raw session logs in the memory vault.
- Reflection may inspect external session traces when the user provides them.
- Durable summaries of session usage may be saved only when useful.
- If saved as evidence, session-usage summaries belong in `sources/`.
- Interpretation derived from summaries belongs in `notes/`, `USER.md`, `projects/`, `people/`, `maps/`, `MEMORY.md`, or `records/`.

## Typical outcomes

Reflection may produce:

- improved map and project routing links
- project-to-note promotion proposals
- `USER.md` compaction or confidence-label cleanup
- new or stronger semantic links between notes and projects
- proposed people-note additions or cleanup
- proposed note merges, splits, or pruning
- a proposed lift + decompose plan for overloaded notes or projects
- token-budget warnings
- stale or weak memory warnings
- a Reflection record in `records/`

High-impact changes require human approval. Examples include deletion, archiving, splitting, merging, materially rewriting `MEMORY.md` or `USER.md`, changing instructions, or altering human-authored meaning.

## Git workflow

Agentic Memory assumes Git-backed persistence, but agents do not commit automatically.

Commit to Git before and after Reflection to see how memory changed over time.

A Reflection closeout should normally provide:

- `git status`
- a concise diff summary when useful
- what changed and why
- what was proposed but not changed
- an optional suggested commit message

The human reviews diffs and commits manually unless they explicitly instruct an agent to commit in that moment.
