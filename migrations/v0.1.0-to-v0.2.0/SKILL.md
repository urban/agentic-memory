---
name: agentic-memory-v0.1.0-to-v0.2.0
version: 0.2.0
description: Migrate an Agentic Memory vault from v0.1.0 to v0.2.0 by normalizing Obsidian frontmatter, flattening semantic links, converting semantic-link sections to callouts, and adding people notes.
---

# Agentic Memory v0.1.0 to v0.2.0 Migration Skill

Use this skill when the user asks to migrate an Agentic Memory vault from `0.1.0` to `0.2.0`.

## Required stance

Be conservative and reviewable.

Do not delete files, rewrite human meaning, or commit automatically. Preserve source/synthesis boundaries and preserve `created` dates.

## Procedure

1. Read `migrations/v0.1.0-to-v0.2.0/MIGRATION.md` completely.
2. Confirm the target vault root.
3. Read the target vault's `AGENTS.md`, `.agentic-memory/LLMS.md`, and `MEMORY.md`.
4. Check `git status --short`.
5. Follow the migration guide exactly:
   - bump `.agentic-memory/LLMS.md` to `version: 0.2.0`
   - update control-plane instructions and templates
   - add `people/` and `.agentic-memory/templates/person.md`
   - normalize frontmatter for managed files
   - flatten atomic-note semantic links
   - convert atomic-note body semantic links to the callout format
   - analyze for durably relevant people and create `type: person` notes only when warranted
   - create a migration record for substantial migrations
6. Run the verification checklist in the migration guide.
7. Summarize changed files, verification results, open questions, and Git status.
8. Do not commit unless explicitly instructed.

## Person-note threshold

Create person notes only for people who are meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

Do not create person notes for incidental names in raw sources, citations, competitor pages, public examples, or historical captures.
