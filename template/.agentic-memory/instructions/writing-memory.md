# Writing Memory

Read this file when creating or editing Agentic Memory files. This is the canonical persistence policy for what to save, where to save it, and when to promote project observations into reusable memory.

## Persist only what matters

Save high-signal durable context:

- stable user preferences
- decisions and rationale
- reusable workflows
- important open questions
- source-grounded synthesis
- meaningful project or system state
- durable context about specific people who matter to ongoing work
- compact records of meaningful work
- repeated prompting, communication, or technical-decision patterns

Do not save:

- chatty updates
- temporary brainstorm noise
- raw session logs
- duplicate summaries
- facts that can be cheaply re-read from current project files or source code
- full artifacts by default
- incidental names from sources, citations, competitor pages, or historical captures

## Choose the smallest correct place

- `MEMORY.md` — core memory, root routing, and active project routes.
- `USER.md` — lean owner facts, communication preferences, glossary meanings, and inferred preferences.
- `maps/` — conceptual/domain framing and progressive-disclosure routing.
- `projects/` — recurring effort state, goals, decisions, open loops, and project-specific routing.
- `notes/` — one durable atomic idea, preference, pattern, heuristic, decision, or concept per file.
- `people/` — durable context about a specific person other than the vault owner.
- `sources/` — immutable evidence.
- `records/` — append-stable recall summaries of work, decisions, handoffs, migrations, sessions, or Reflection.
- `.agentic-memory/` — LLM control plane; edit only when intentionally changing how the memory system works.

Use `.agentic-memory/templates/` as scaffolds when creating new memory files. Template files are not themselves managed memory content.

## Frontmatter formatting

Use Obsidian-compatible YAML frontmatter for managed memory files.

- Use `aliases`, not deprecated `alias`.
- Every managed page must have at least one human-readable alias, usually matching the H1.
- Quote every `summary` value.
- Empty list properties such as `tags: []`, `sources: []`, and `similar_to: []` are acceptable.
- Non-empty list properties should use YAML block-list format.
- Quote internal links in frontmatter list values.
- Do not use nested frontmatter properties.
- For atomic notes and projects, use top-level `comes_from`, `similar_to`, `leads_to`, and `competes_with`; do not nest them under `links`.

Example atomic note:

```yaml
---
type: note
status: draft
maturity: seedling
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "One-line summary."
aliases:
  - "Human Readable Title"
tags: []
sources:
  - "[[sources/example]]"
comes_from: []
similar_to:
  - "[[notes/example]]"
leads_to: []
competes_with: []
---
```

Example project:

```yaml
---
type: project
status: active
project_status: candidate
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "One-line project summary."
aliases:
  - "Project Name"
tags: []
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with: []
---
```

## `MEMORY.md` rules

`MEMORY.md` is always loaded, so it must stay lean and budget-sensitive.

Use it only for:

- top-level routes to memory maps
- a dedicated Projects section for active, recurring, or important project routes
- durable cross-cutting preferences too important not to see early
- active threads that matter across sessions
- broad open questions that affect future work

Do not use it for:

- long history
- detailed project notes
- full artifacts
- raw source summaries
- agent instructions
- user-specific detail that belongs in `USER.md`

When `MEMORY.md` grows, move detail into `USER.md`, `maps/`, `projects/`, `notes/`, `people/`, or `records/` and leave a compact routing link.

Route links in `MEMORY.md` must use:

```md
- [[maps/name]] — description. Read when: condition.
- [[projects/name]] — description. Read when: condition.
```

## `USER.md` rules

`USER.md` is always loaded after `MEMORY.md`, so it must stay lean and pointer-heavy.

Use it for:

- stable facts about the vault owner / primary user
- explicit long-lived preferences
- user-specific glossary terms and phrase meanings
- communication and response-format preferences
- compact pointers to atomic notes about user patterns
- lower-confidence inferred preferences, clearly labeled

Do not use it for:

- full biography
- raw session logs
- project-specific details
- detailed technical rationale better represented as atomic notes
- sensitive or private speculation
- repeated paragraphs duplicated from project files

Confidence labels:

- `Explicit` — directly stated by the user.
- `Repeated` — observed across projects or many sessions.
- `Observed` — observed in one project or a small number of sessions.
- `Inferred` — plausible but lower-confidence; verify before relying on it.

When a user pattern needs detail, source context, or semantic links, create or update an atomic note and link it from `USER.md`.

## Project rules

Project files live in `projects/` and use `type: project`.

A project can be a candidate, active project, completed project, archived project, or umbrella effort. It should correspond to a durable recurring effort rather than a one-off task.

Use project files for:

- purpose, goals, and objectives
- current durable state
- key decisions and rationale
- open questions and tradeoffs
- next useful context for future sessions
- routing to subprojects, maps, notes, people, records, sources, and repos
- project-local observations that may later be promoted

Do not use project files for:

- source-code summaries that can be cheaply re-read
- full implementation logs
- every task status update
- duplicated cross-project patterns already captured in atomic notes or `USER.md`

Dated work history belongs in `records/`. Raw evidence belongs in `sources/`. Reusable patterns belong in `notes/` or `USER.md`.

## Promotion rules

Project memory is a staging layer. Promote information out of a project when it becomes useful beyond that project.

Promote into `notes/` or `USER.md` when an observation is:

- repeated across two or more projects or many sessions
- useful for future decisions beyond the source project
- not cheaply re-derived from current project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or clearly marked as inferred / lower-confidence
- better represented once than duplicated in many project files

Use `notes/` for reusable principles, prompting patterns, technical rationale, workflows, decision heuristics, and cross-project insights.

Use `USER.md` for stable owner facts, communication preferences, glossary meanings, and compact links to detailed user-pattern notes.

After promotion, link project files to the source-of-truth note or `USER.md` entry and compact duplicate project-local wording when safe.

## People rules

Create a person note in `people/` only when a person other than the vault owner is meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

Do not create person notes for every name found in text. Avoid notes for incidental names in raw sources, citations, competitor pages, articles, or historical captures unless the person is directly relevant to future work.

Person notes should:

- use `type: person`
- include a human-readable `aliases` value, usually the person's name
- capture stable, useful, non-sensitive context
- separate evidence from synthesis when claims matter
- mark uncertainty visibly
- avoid inferring sensitive traits or private facts without explicit evidence

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

A draft note or project candidate is incomplete or weakly connected. It is not automatically bad.

Draft notes and project candidates can be promoted, merged, archived, or deleted. Deletion requires explicit human approval.

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
- Use semantic links for atomic notes and projects.
- Use routing links for memory maps and project routing sections.
- Keep `USER.md` and `MEMORY.md` lean.
- Do not commit automatically.
