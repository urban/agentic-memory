# Operating Model

Agentic Memory is designed for agents that need durable memory without turning every session into a context dump.

Human-facing docs explain the system. Vault-local LLM instructions in `.agentic-memory/` tell agents how to operate a specific vault.

## Startup

Agentic Memory has two startup routes.

1. **Vault-local startup**: when the harness starts inside an initialized Agentic Memory vault, it should read the root `AGENTS.md`. That file routes to `.agentic-memory/LLMS.md`.
2. **Cross-project bootstrap startup**: when the harness starts outside the vault, a global or project-level adapter copied from `BOOTSTRAP.md` points at the central vault. Current project instructions remain primary; the central vault is secondary durable memory.

If a global bootstrap is active while the harness is inside the memory vault, treat it as redundant and follow the vault-local `AGENTS.md` path.

After `.agentic-memory/LLMS.md` is reached through either route, agents should read `MEMORY.md`, read `USER.md`, and then follow `LLMS.md` to optional instruction files based on the task.

For project-oriented work, the agent should identify the relevant existing project, umbrella project, or project candidate before deciding what else to load.

## Reading rules

- Use progressive disclosure.
- Prefer routing surfaces before detailed notes.
- Read summaries and `Read when:` clauses before opening linked files.
- Use vault-root-relative wikilinks for memory content, such as `[[USER]]`, `[[maps/name]]`, `[[projects/name]]`, `[[notes/name]]`, or `[[people/name]]`.
- Do not load all notes just because they exist.
- Treat `USER.md` as lean owner context; follow its note links only when relevant.
- Treat project files as current-state routing surfaces, not complete histories.
- Treat sources as evidence, not default context.
- Treat records as compact recall summaries, not full artifacts.

## Writing rules

Use the smallest correct memory layer:

- `MEMORY.md` — cross-cutting core memory, root routing, and active project routes.
- `USER.md` — lean durable owner facts, communication preferences, glossary terms, and inferred preferences.
- `maps/` — conceptual/domain framing and navigation.
- `projects/` — durable recurring effort state, goals, decisions, open loops, and project-specific routing.
- `notes/` — atomic durable ideas, preferences, patterns, heuristics, and reusable knowledge.
- `people/` — durable context about specific people other than the vault owner.
- `sources/` — immutable captured evidence.
- `records/` — append-stable summaries of work, decisions, sessions, migrations, handoffs, or Reflection.

The LLM control plane is separate:

- `.agentic-memory/LLMS.md` — local version, system contract, and baseline agent operating policy.
- `.agentic-memory/instructions/` — optional task-specific agent instructions.
- `.agentic-memory/templates/` — scaffolds agents can use when creating memory files.

Edit control-plane files only when changing how the memory system works, not when storing task memory.

Prefer updating existing files over creating duplicates.

Use Obsidian-compatible frontmatter when writing managed memory files:

- quote `summary` values
- include at least one human-readable `aliases` value
- use block lists for non-empty list properties
- quote internal links inside frontmatter lists
- keep semantic-link properties flat (`comes_from`, `similar_to`, `leads_to`, `competes_with`), not nested under `links`

## What to persist

Persist only high-signal information likely to help future agents:

- stable user preferences
- durable decisions and rationale
- reusable workflows
- important project or system context
- source-grounded synthesis
- open questions worth revisiting
- repeated prompting, communication, or technical-decision patterns
- Reflection findings that improve future memory use
- compact records of meaningful work done elsewhere

Do not persist:

- chatty status updates
- temporary brainstorm noise
- low-confidence speculation without context
- raw session logs
- repeated paraphrases of existing memory
- facts that are cheap to re-read from the current repo or project files
- full artifacts by default

## Cross-project persistence

When an agent works outside the memory vault, its primary job remains the current task. Its secondary job is to preserve durable context in the memory vault when doing so would help future work.

Use repository-level `BOOTSTRAP.md` as the canonical bootstrap snippet for harness-specific entry points such as user-level `AGENTS.md`, Claude `CLAUDE.md`, Pi `APPEND_SYSTEM.md`, or repo-level `AGENTS.md` / `CLAUDE.md`. Those adapter files are not required Agentic Memory content. See `docs/bootstrap.md` for human-facing setup guidance.

The agent should proactively update memory at natural stopping points when it observes high-signal context, especially:

- a project candidate becoming a recurring effort
- a current project state or open loop that future sessions need
- a decision or rationale that is not obvious from source files
- a repeated user preference, glossary meaning, communication pattern, or tech-selection rationale
- a reusable workflow or prompting pattern that may help future projects

Repeated project-specific observations should be promoted into `notes/` or `USER.md` and linked from the project files. Project files should not become the long-term home for reusable cross-project knowledge.

## Authorship and trust

- Preserve human authorship and intent.
- Keep source material distinct from agent synthesis.
- Mark uncertainty explicitly.
- Do not silently convert an agent proposal into accepted user direction.
- Label user preferences as explicit, observed, repeated, or inferred when confidence matters.
- If memory conflicts with current evidence, current evidence wins.

## Uncertainty

Use visible prose markers instead of hidden comments or hashtag taxonomy.

Good patterns:

```md
## Uncertainty

- Needs verification: ...
- Assumption: ...
- Low confidence: ...
```

Inline labels are acceptable:

```md
- Explicit: The user said...
- Observed: Across this project, the user repeatedly...
- Inferred: The user may prefer...; verify before relying on this.
- Needs verification: Confirm against source before relying on this.
```

Use `TODO:` or `FIXME:` only for concrete maintenance tasks.

## Updating memory

When editing a managed Markdown file:

- preserve `created`
- update `updated` on material edits
- keep summaries current
- maintain root routes in `MEMORY.md`
- maintain project routes and lifecycle state in `projects/`
- maintain `USER.md` as lean pointer-heavy owner context
- maintain memory-map routing links
- maintain semantic links for atomic notes and projects
- maintain person notes when durable people context emerges
- keep files within token budgets when possible
- maintain the distinction between sources, notes, records, projects, maps, and user memory

## Promotion into evergreen memory

Project memory is a staging area for durable discoveries, not the final home for reusable knowledge.

Promote an observation into an atomic note or `USER.md` when it is:

- repeated across two or more projects or across many sessions
- useful for future decisions beyond the source project
- not cheaply re-derived from current project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or clearly marked as inferred / lower-confidence
- better represented once than duplicated in many project files

Use `notes/` for reusable principles, decision heuristics, workflows, prompting patterns, and technical rationale. Use `USER.md` for stable owner facts, communication preferences, glossary meanings, and compact links to detailed user-pattern notes.

## Closing a session

Before ending substantial work, ask:

- What should future agents remember?
- Which project did this session correspond to?
- Does a project file, project candidate, or project route need to be updated?
- Did this reveal a reusable pattern that should be promoted to an atomic note or `USER.md`?
- Does any memory need to be updated, linked, or compacted?
- Did the task reveal a missing memory map or atomic note?
- Did any file exceed its intended budget?
- Should a source capture or compact record be saved?

Then make the smallest useful memory update.

## Git workflow

Agentic Memory assumes Git-backed persistence.

- Check `git status` before substantial edits when practical.
- Use `git diff` to understand memory formation over time.
- Summarize changed files and rationale at closeout.
- Do not commit automatically.
- Reflection should also stop after status/diff summary and leave committing to the human unless explicitly instructed otherwise.
