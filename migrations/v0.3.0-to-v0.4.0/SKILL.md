---
name: agentic-memory-v0.3.0-to-v0.4.0
version: 0.4.0
description: Migrate an Agentic Memory vault from v0.3.0 to v0.4.0 by replacing the control plane, adding session-capture guidance, and normalizing project files around resume context, project timeline, and decision log sections.
---

# Agentic Memory v0.3.0 to v0.4.0 Migration Skill

Use this skill when the user asks to migrate an Agentic Memory vault from `0.3.0` to `0.4.0`.

## Required stance

Be conservative and reviewable.

Do not rewrite human memory meaning, fabricate project timelines, delete managed memory content, or commit automatically. Preserve source/synthesis boundaries and preserve `created` dates.

## Procedure

1. Read `migrations/v0.3.0-to-v0.4.0/MIGRATION.md` completely.
2. Confirm the target vault root.
3. Read the target vault's `AGENTS.md`, `MEMORY.md`, `USER.md`, and current `.agentic-memory/` control-plane files relevant to the migration.
4. Check `git status --short`.
5. Follow the migration guide exactly:
   - replace `.agentic-memory/` with the `0.4.0` template control plane
   - ensure both LLM contract files declare `version: 0.4.0`
   - add `.agentic-memory/instructions/session-capture.md`
   - update writing/cross-project instructions
   - normalize project templates and durable project files around `Resume context`, `Project timeline`, and `Decision log`
   - avoid turning project files into issue trackers
6. Run the verification checklist in the migration guide.
7. Summarize changed files, verification results, open questions, and Git status.
8. Do not commit unless explicitly instructed.
