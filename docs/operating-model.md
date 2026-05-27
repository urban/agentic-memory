# Operating Model

Agentic Memory is designed for agents that need durable memory without turning every session into a context dump.

Human-facing docs explain the system. Vault-local LLM instructions in `.agentic-memory/` tell agents how to operate a specific vault.

## Startup

At the start of meaningful vault work, agents should read:

1. `AGENTS.md`
2. `.agentic-memory/LLMS.md`
3. `MEMORY.md`

Then `LLMS.md` routes to optional instruction files based on the task.

## Reading rules

- Use progressive disclosure.
- Prefer routing surfaces before detailed notes.
- Read summaries and `Read when:` clauses before opening linked files.
- Use vault-root-relative wikilinks for memory content, such as `[[maps/name]]` or `[[notes/name]]`.
- Do not load all notes just because they exist.
- Treat sources as evidence, not default context.
- Treat records as compact recall summaries, not full artifacts.

## Writing rules

Use the smallest correct memory layer:

- `MEMORY.md` — cross-cutting core memory and root routing.
- `maps/` — routing and navigation.
- `notes/` — atomic durable ideas.
- `sources/` — immutable captured evidence.
- `records/` — append-stable summaries of work, decisions, sessions, migrations, handoffs, or Reflection.

The LLM control plane is separate:

- `.agentic-memory/LLMS.md` — local version, system contract, and baseline agent operating policy.
- `.agentic-memory/instructions/` — optional task-specific agent instructions.
- `.agentic-memory/templates/` — scaffolds agents can use when creating memory files.

Edit control-plane files only when changing how the memory system works, not when storing task memory.

Prefer updating existing files over creating duplicates.

## What to persist

Persist only high-signal information likely to help future agents:

- stable user preferences
- durable decisions and rationale
- reusable workflows
- important project or system context
- source-grounded synthesis
- open questions worth revisiting
- Reflection findings that improve future memory use
- compact records of meaningful work done elsewhere

Do not persist:

- chatty status updates
- temporary brainstorm noise
- low-confidence speculation without context
- raw session logs
- repeated paraphrases of existing memory
- facts that are cheap to re-read from the current repo
- full artifacts by default

## Authorship and trust

- Preserve human authorship and intent.
- Keep source material distinct from agent synthesis.
- Mark uncertainty explicitly.
- Do not silently convert an agent proposal into accepted user direction.
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
- Assumption: This applies when...
- Needs verification: Confirm against source before relying on this.
```

Use `TODO:` or `FIXME:` only for concrete maintenance tasks.

## Updating memory

When editing a managed Markdown file:

- preserve `created`
- update `updated` on material edits
- keep summaries current
- maintain memory-map routing links
- maintain semantic links for atomic notes
- keep files within token budgets when possible
- maintain the distinction between sources, notes, records, and map files

## Closing a session

Before ending substantial work, ask:

- What should future agents remember?
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
