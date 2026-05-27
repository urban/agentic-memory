---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: How agents operate an Agentic Memory vault.
---

# Operating Model

Agentic Memory is designed for agents that need durable memory without turning every session into a context dump.

## Startup

At the start of meaningful work:

1. Read `AGENTS.md`.
2. Read `MEMORY.md`.
3. Follow only the relevant MOC links from `MEMORY.md`.
4. Load atomic notes only when a MOC or semantic link says they are relevant.
5. Load sources only for verification or ingestion.

## Reading rules

- Use progressive disclosure.
- Prefer routing surfaces before detailed notes.
- Read summaries and `Read when:` clauses before opening linked files.
- Do not load all notes just because they exist.
- Treat sources as evidence, not default context.

## Writing rules

Use the smallest correct layer:

- `MEMORY.md` — cross-cutting core memory and root routing.
- `mocs/` — routing and navigation.
- `notes/` — atomic durable ideas.
- `sources/` — immutable captured evidence.
- `outputs/` — durable artifacts.
- `instructions/` — local agent operating policy.

Prefer updating existing files over creating duplicates.

## What to persist

Persist only high-signal information likely to help future agents:

- stable user preferences
- durable decisions and rationale
- reusable workflows
- important project or system context
- source-grounded synthesis
- open questions worth revisiting
- reflection findings that improve future memory use

Do not persist:

- chatty status updates
- temporary brainstorm noise
- low-confidence speculation without context
- raw session logs
- repeated paraphrases of existing memory
- facts that are cheap to re-read from the current repo

## Authorship and trust

- Preserve human authorship and intent.
- Keep source material distinct from agent synthesis.
- Mark uncertainty explicitly.
- Do not silently convert an agent proposal into accepted user direction.
- If memory conflicts with current evidence, current evidence wins.

## Updating memory

When editing a managed Markdown file:

- preserve `created`
- update `updated` on material edits
- keep summaries current
- maintain MOC routing links
- maintain semantic links for atomic notes
- keep files within token budgets when possible

## Closing a session

Before ending substantial work, ask:

- What should future agents remember?
- Does any memory need to be updated, linked, or compacted?
- Did the task reveal a missing MOC or atomic note?
- Did any file exceed its intended budget?
- Should a durable output or source capture be saved?

Then make the smallest useful memory update.

## Git workflow

Agentic Memory assumes Git-backed persistence.

- Check `git status` before substantial edits when practical.
- Keep commits focused.
- Use lightweight memory commit prefixes.
- Reflection should prepare a commit message and ask before committing.
