# Writing Memory

Read this file when creating or editing Agentic Memory files.

## Persist only what matters

Save high-signal durable context:

- stable preferences
- decisions and rationale
- reusable workflows
- important open questions
- source-grounded synthesis
- meaningful project or system state
- compact records of meaningful work

Do not save:

- chatty updates
- temporary brainstorm noise
- raw session logs
- duplicate summaries
- facts that can be cheaply re-read
- full artifacts by default

## Choose the smallest correct place

- `MEMORY.md` — core memory and root routing.
- `maps/` — navigation and progressive-disclosure routing.
- `notes/` — one durable atomic idea per file.
- `sources/` — immutable evidence.
- `records/` — append-stable recall summaries of work, decisions, handoffs, migrations, sessions, or Reflection.
- `.agentic-memory/` — LLM control plane; edit only when intentionally changing how the memory system works.

Use `.agentic-memory/templates/` as scaffolds when creating new memory files. Template files are not themselves managed memory content.

## `MEMORY.md` rules

`MEMORY.md` is always loaded, so it must stay lean and budget-sensitive.

Use it only for:

- top-level routes to memory maps
- durable cross-cutting preferences
- active threads that matter across sessions
- broad open questions that affect future work

Do not use it for:

- long history
- detailed project notes
- full artifacts
- raw source summaries
- agent instructions

When `MEMORY.md` grows, move detail into `maps/`, `notes/`, or `records/` and leave a compact routing link.

Route links in `MEMORY.md` must use:

```md
- [[maps/name]] — description. Read when: condition.
```

## Source rules

Sources are immutable evidence.

After capture, do not materially rewrite a source. If a capture is wrong, create a corrected source or document the correction explicitly.

Put provenance in the body when it matters.

## Record rules

Records are append-stable, not strictly immutable.

Allowed:

- fix typos
- add missing links
- add artifact locations or follow-up links
- correct factual errors with a dated correction note
- update metadata like `updated`

Avoid:

- rewriting history
- replacing original rationale with later interpretation
- deleting uncomfortable or obsolete context

If understanding changes, add:

```md
## Later update — YYYY-MM-DD

- Correction or changed understanding...
```

## Draft and deletion rules

A draft note is incomplete or weakly connected. It is not automatically bad.

Draft notes can be promoted, merged, archived, or deleted. Deletion requires explicit human approval.

Do not use `status: deleted`; Git preserves deletion history.

## Uncertainty

Use visible prose markers:

```md
## Uncertainty

- Needs verification: ...
- Assumption: ...
- Low confidence: ...
```

Use `TODO:` or `FIXME:` only for concrete maintenance tasks.

## File maintenance

- Preserve `created`.
- Update `updated` on material edits.
- Prefer editing existing files over creating duplicates.
- Keep files within budget.
- Keep source and synthesis separate.
- Use vault-root-relative wikilinks for memory content.
- Use semantic links for atomic notes.
- Use routing links for memory maps.
- Do not commit automatically.
