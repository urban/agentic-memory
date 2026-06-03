# Agentic Memory v0.2.0 to v0.3.0 Migration

This is a manual/LLM-assisted migration from Agentic Memory `0.2.0` to `0.3.0`.

It is intentionally written as an instruction file that can be given to an LLM agent. The agent should perform the migration, verify the result, and leave changes for human review. Do not commit automatically.

## Purpose

Version `0.3.0` adds first-class project memory, root-level user memory, cross-project persistence instructions, and separate LLM contracts for vault-local and outside-vault use.

The migration changes:

1. Replace the existing `.agentic-memory/` control-plane directory with the v0.3.0 template control plane.
2. Replace the old shared v0.2 LLM contract with `.agentic-memory/LLM-vault-local.md` and `.agentic-memory/LLM-outside-vault.md`.
3. Update root `AGENTS.md` so vault-local agents read `.agentic-memory/LLM-vault-local.md`.
4. Add `USER.md` at the vault root with `type: user`.
5. Add `projects/` for `type: project` files.
6. Add `.agentic-memory/templates/user.md` and `.agentic-memory/templates/project.md`.
7. Add `.agentic-memory/instructions/cross-project-persistence.md`.
8. Add `.agentic-memory/adapters/MEMORY_ADAPTER.md` as a human-installed adapter snippet for outside-vault harness entry points.
9. Expand the managed type set to `core|user|map|project|note|person|source|record`.
10. Add a dedicated Projects section to `MEMORY.md` when useful.
11. Clarify maps as high-level conceptual/domain framing supported by notes and projects.
12. Treat project files as project-specific memory maps plus durable state.
13. Promote repeated project observations into atomic notes or `USER.md` when they become reusable.

## Required target structure

After migration, the vault should have:

```text
AGENTS.md
MEMORY.md
USER.md
.agentic-memory/
├── LLM-vault-local.md
├── LLM-outside-vault.md
├── adapters/
│   └── MEMORY_ADAPTER.md
├── instructions/
│   ├── writing-memory.md
│   ├── linking-and-maps.md
│   ├── cross-project-persistence.md
│   └── reflection.md
└── templates/
    ├── map.md
    ├── project.md
    ├── note.md
    ├── person.md
    ├── record.md
    ├── reflection-record.md
    ├── source.md
    └── user.md
maps/
projects/
notes/
people/
sources/
records/
```

## Safety rules

- Preserve human-authored memory content and meaning.
- Preserve `created` dates on managed memory files.
- Update `updated` dates when materially changing managed memory files.
- Keep source material distinct from synthesis.
- This migration explicitly replaces the old `.agentic-memory/` control plane with the v0.3.0 control plane; do not treat that replacement as permission to delete managed memory content.
- Do not delete managed memory files without explicit human approval.
- Do not commit automatically.
- Do not infer user preferences from one-off behavior without marking them as `Observed` or `Inferred`.
- Do not store facts in project memory when they can be cheaply re-read from source files.

## Procedure for an LLM agent

### 1. Confirm the target vault

Confirm the vault root contains:

```text
AGENTS.md
MEMORY.md
.agentic-memory/
```

Read:

1. `AGENTS.md`
2. the existing v0.2 shared LLM contract, if present
3. `MEMORY.md`
4. `USER.md`, if present
5. `.agentic-memory/instructions/writing-memory.md`, if present
6. `.agentic-memory/instructions/linking-and-maps.md`, if present

Check `git status --short` before editing when practical.

If the existing control plane contains local deviations, summarize them before replacement and preserve only the parts that are still compatible with the v0.3.0 contract.

### 2. Replace the control plane

Replace the target vault's existing `.agentic-memory/` directory with the v0.3.0 template `.agentic-memory/` directory.

The replacement control plane must include:

```text
.agentic-memory/LLM-vault-local.md
.agentic-memory/LLM-outside-vault.md
.agentic-memory/adapters/MEMORY_ADAPTER.md
.agentic-memory/instructions/writing-memory.md
.agentic-memory/instructions/linking-and-maps.md
.agentic-memory/instructions/cross-project-persistence.md
.agentic-memory/instructions/reflection.md
.agentic-memory/templates/map.md
.agentic-memory/templates/project.md
.agentic-memory/templates/note.md
.agentic-memory/templates/person.md
.agentic-memory/templates/record.md
.agentic-memory/templates/reflection-record.md
.agentic-memory/templates/source.md
.agentic-memory/templates/user.md
```

Both LLM contract files must declare:

```yaml
---
version: 0.3.0
---
```

The old shared LLM contract file must not remain in the target vault after the replacement.

Update root `AGENTS.md` so it routes vault-local agents to:

```text
.agentic-memory/LLM-vault-local.md
```

The adapter snippet should remain short and should route outside-vault agents to:

```text
/absolute/path/to/memory-vault/.agentic-memory/LLM-outside-vault.md
```

The adapter should check only whether the current working directory contains `.agentic-memory/`; it should not search ancestor directories.

### 3. Add root user memory

Create `USER.md` if missing:

```yaml
---
type: user
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "Lean durable context about the vault owner."
aliases:
  - "User"
tags: []
sources: []
---
```

Recommended sections:

```md
# User

## Profile

## Communication

## Glossary

## Preferences and working patterns

## Inferred preferences

## Related notes
```

Keep `USER.md` lean. Move detailed patterns into atomic notes and link them.

### 4. Add projects directory

Create:

```text
projects/
```

Add `.gitkeep` if the directory is empty.

### 5. Update `MEMORY.md`

Add a dedicated Projects section when the vault has active, recurring, umbrella, or important project-candidate routes.

Example:

```md
## Projects

- [[projects/example-project]] — current project state and routing. Read when: resuming this project.
```

Do not list every project if a parent project or map is a better route.

### 6. Identify initial project candidates

Review existing maps, notes, records, and recent durable context for recurring efforts that deserve project files.

Create a `projects/*.md` file only when the effort is durable enough to benefit future sessions.

Use:

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

### 7. Promote repeated observations conservatively

Look for repeated project observations that should become atomic notes or `USER.md` entries.

Promote only when the observation is:

- repeated across two or more projects or many sessions
- useful beyond the source project
- not cheaply re-derived from project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or clearly marked as inferred / lower-confidence
- better represented once than duplicated in projects

If unsure, leave the observation in a project file as `Observed` or `Inferred` and note the open question.

### 8. Create a migration record

For substantial migrations, create:

```text
records/YYYY-MM-DD-v0.2.0-to-v0.3.0-migration.md
```

Use `record_type: migration` and v0.3.0 frontmatter.

Capture:

- what changed
- why it changed
- project files created or proposed
- `USER.md` entries created or proposed
- promotion decisions
- files intentionally left unchanged
- open questions

## Verification checklist

- `.agentic-memory/LLM-vault-local.md` declares `version: 0.3.0`.
- `.agentic-memory/LLM-outside-vault.md` declares `version: 0.3.0`.
- The old shared LLM contract file is absent.
- `AGENTS.md` routes to `.agentic-memory/LLM-vault-local.md`.
- `USER.md` exists and uses `type: user`.
- `projects/` exists.
- `.agentic-memory/templates/project.md` exists.
- `.agentic-memory/templates/user.md` exists.
- `.agentic-memory/instructions/cross-project-persistence.md` exists.
- `.agentic-memory/adapters/MEMORY_ADAPTER.md` exists and routes to `.agentic-memory/LLM-outside-vault.md`.
- Managed type guidance includes `user` and `project`.
- Link guidance includes `[[USER]]` and `[[projects/name]]`.
- `MEMORY.md` has a Projects section when useful.
- Project files, if created, include `project_status`.
- No raw session logs were copied into the vault.
- No source-code facts were redundantly stored in project memory.
- User observations are labeled by confidence when needed.
- Repeated cross-project insights were promoted or explicitly left as open candidates.
- `git status --short` was reviewed.

## Closeout

Summarize:

- changed files
- migration decisions
- project/user memory created or intentionally deferred
- verification results
- open questions
- Git status

Do not commit unless explicitly instructed.
