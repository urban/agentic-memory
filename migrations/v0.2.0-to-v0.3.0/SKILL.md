---
name: agentic-memory-v0.2.0-to-v0.3.0
version: 0.3.0
description: Migrate an Agentic Memory vault from v0.2.0 to v0.3.0 by replacing the control plane, adding USER.md, projects/, project/user templates, cross-project persistence instructions, and the memory adapter.
---

# Agentic Memory v0.2.0 to v0.3.0 Migration Skill

Use this skill when the user asks to migrate an Agentic Memory vault from `0.2.0` to `0.3.0`.

## Required stance

Be conservative and reviewable.

Do not rewrite human memory meaning, infer stable user preferences from one-off behavior, delete managed memory content, or commit automatically. Preserve source/synthesis boundaries and preserve `created` dates.

This migration is allowed to replace the target vault's old `.agentic-memory/` control-plane directory with the v0.3.0 template control plane.

## Procedure

1. Read `migrations/v0.2.0-to-v0.3.0/MIGRATION.md` completely.
2. Confirm the target vault root.
3. Read the target vault's `AGENTS.md`, existing v0.2 shared LLM contract if present, `MEMORY.md`, and `USER.md` if present.
4. Check `git status --short`.
5. Follow the migration guide exactly:
   - replace `.agentic-memory/` with the v0.3.0 template control plane
   - ensure `.agentic-memory/LLM-vault-local.md` and `.agentic-memory/LLM-outside-vault.md` both declare `version: 0.3.0`
   - ensure the old shared LLM contract file is absent
   - update `AGENTS.md` to route to `.agentic-memory/LLM-vault-local.md`
   - add `USER.md`
   - add `projects/`
   - add `type: user` and `type: project` guidance
   - add cross-project persistence instructions
   - add `.agentic-memory/adapters/MEMORY_ADAPTER.md`
   - update `MEMORY.md` with a Projects section when useful
   - identify project candidates conservatively
   - promote repeated project observations into atomic notes or `USER.md` only when criteria are met
   - create a migration record for substantial migrations
6. Run the verification checklist in the migration guide.
7. Summarize changed files, verification results, open questions, and Git status.
8. Do not commit unless explicitly instructed.

## Project threshold

Create project files only for durable recurring efforts, active projects, umbrella efforts, completed/archived projects worth retaining, or project candidates likely to recur.

Do not create project files for one-off tasks that are unlikely to help future sessions.

## User-memory threshold

Use `USER.md` for stable or long-lived owner context. Label preferences as `Explicit`, `Repeated`, `Observed`, or `Inferred` when confidence matters.

Move detailed reusable user patterns into atomic notes and link them from `USER.md`.
