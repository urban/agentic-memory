---
type: agent
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Rules for writing and updating Agentic Memory files.
---

# Writing Memory

## Persist only what matters

Save high-signal durable context:

- stable preferences
- decisions and rationale
- reusable workflows
- important open questions
- source-grounded synthesis
- meaningful project or system state

Do not save:

- chatty updates
- temporary brainstorm noise
- raw session logs
- duplicate summaries
- facts that can be cheaply re-read

## Choose the smallest correct place

- `MEMORY.md` — core memory and root routing.
- `mocs/` — navigation and progressive-disclosure routing.
- `notes/` — one durable atomic idea per file.
- `sources/` — immutable evidence or source-like records.
- `outputs/` — reusable artifacts.
- `instructions/` — local operating policy.

## File maintenance

- Preserve `created`.
- Update `updated` on material edits.
- Prefer editing existing files over creating duplicates.
- Keep files within budget.
- Keep source and synthesis separate.
- Use semantic links for atomic notes.
- Use routing links for MOCs.
