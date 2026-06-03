# Writing Memory

Canonical policy for what to save and where. Use templates for exact scaffolds.

## Before editing

- Prefer updating existing memory over creating duplicates.
- Preserve `created`; update `updated` on material edits.
- Keep human wording/intent unless asked to rewrite.
- Check relevant routes/links after edits.
- Do not commit automatically.

## Save / skip

Save only durable, high-signal context: decisions/rationale, reusable workflows, stable user preferences, meaningful project state, important open questions, source-grounded synthesis, useful people context, compact work records, and repeated prompting/communication/tech-selection patterns.

Skip chatty updates, brainstorm noise, raw logs, duplicate summaries, full artifacts by default, incidental names, and facts cheaply re-read from current project files/source code.

## Smallest correct layer

- `MEMORY.md`: always-loaded root routes, active/important project routes, rare cross-cutting facts that must be seen early.
- `USER.md`: lean owner facts, communication preferences, glossary terms, and compact links to user-pattern notes.
- `maps/`: high-level domain/concept framing and routing.
- `projects/`: durable recurring-effort state, goals, decisions, open loops, next context, and project-specific routing.
- `notes/`: one reusable idea, preference, pattern, heuristic, decision, question, or concept.
- `people/`: useful non-sensitive context about a specific person other than the owner.
- `sources/`: immutable evidence; put provenance in the body when useful.
- `records/`: append-stable summaries of work, decisions, migrations, sessions, handoffs, or Reflection.
- `.agentic-memory/`: control plane only; edit only to change agent behavior.

## Frontmatter

Managed memory files require Obsidian-compatible YAML frontmatter. Use templates, and ensure:

- `type: core|user|map|project|note|person|source|record`
- `status: draft|active|stale|archived`
- `created`, `updated`, quoted `summary`, and non-empty `aliases`
- block lists for non-empty list values; quote wikilinks in frontmatter lists
- no nested properties
- notes include `maturity: seedling|budding|evergreen`
- projects include `project_status: candidate|active|completed|archived`
- notes/projects use top-level `comes_from`, `similar_to`, `leads_to`, `competes_with`

No `status: deleted`; deletion needs explicit human approval and Git preserves history.

## `MEMORY.md`

Keep lean. Use for top-level maps/projects, important cross-session threads, broad open questions, and early-needed preferences. Move detail to `USER.md`, maps, projects, notes, people, records, or sources and leave a route.

## `USER.md`

Keep lean and pointer-heavy. Use for stable owner context, response preferences, glossary meanings, and clearly labeled inferred preferences. Put detailed reusable patterns in `notes/` and link them.

Confidence labels: `Explicit` (user said), `Repeated` (across projects/many sessions), `Observed` (limited evidence), `Inferred` (lower confidence; verify).

## Projects

Create/update a project only for durable recurring efforts, active/completed/archived efforts worth recalling, umbrella efforts, or likely-to-recur candidates.

Capture durable state, goals, decisions/rationale, open loops, next useful context, routing, and project-local observations that may later be promoted. Do not store source-code summaries, task logs, every status update, or duplicated cross-project patterns.

## Promotion

Project memory is staging. Promote to `notes/` or `USER.md` when an observation is repeated, useful beyond one project, not cheaply re-derived, expressible as one reusable pattern/rationale/workflow/preference, stable enough or labeled uncertain, and better represented once than duplicated.

After promotion: update/create the destination, link originating projects to it, and compact safe duplicate wording.

## People, sources, records

- People: create only for meaningful future collaboration/context. Avoid sensitive/speculative/private inferences.
- Sources: immutable after capture; correct by new source or visible correction.
- Records: append-stable; fix typos/links/facts, but do not rewrite history. Add dated correction/update sections when understanding changes.

## Uncertainty

Use visible prose: `Needs verification:`, `Assumption:`, `Low confidence:`. Use `TODO:`/`FIXME:` only for concrete maintenance tasks.
