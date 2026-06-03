# Agentic Memory v0.2.0 to v0.3.0 Migration

This is a manual/LLM-assisted migration from Agentic Memory `0.2.0` to `0.3.0`.

It is intentionally written as an instruction file that can be given to an LLM agent. The agent should perform the migration, verify the result, and leave changes for human review. Do not commit automatically.

## Purpose

Version `0.3.0` adds first-class project memory, root-level user memory, and cross-project persistence instructions.

The migration changes:

1. `version: 0.2.0` → `version: 0.3.0` in `.agentic-memory/LLMS.md`.
2. `USER.md` is added at the vault root with `type: user`.
3. `projects/` is added for `type: project` files.
4. `.agentic-memory/templates/user.md` and `.agentic-memory/templates/project.md` are added.
5. `.agentic-memory/instructions/cross-project-persistence.md` is added.
6. The repository-level `BOOTSTRAP.md` provides a human-installed cross-project bootstrap snippet for harness-specific entrypoints.
7. The managed type set expands to `core|user|map|project|note|person|source|record`.
8. `MEMORY.md` gains a dedicated Projects section when useful.
9. Maps are clarified as high-level conceptual/domain framing supported by notes and projects.
10. Project files become project-specific memory maps plus durable state.
11. Repeated project observations should be promoted into atomic notes or `USER.md`.

## Required target structure

After migration, the vault should have:

```text
AGENTS.md
MEMORY.md
USER.md
.agentic-memory/
├── LLMS.md
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

- Preserve human-authored meaning.
- Preserve `created` dates.
- Update `updated` dates when materially changing managed files.
- Keep source material distinct from synthesis.
- Do not delete files without explicit human approval.
- Do not commit automatically.
- Do not infer user preferences from one-off behavior without marking them as `Observed` or `Inferred`.
- Do not store facts in project memory when they can be cheaply re-read from source files.

## Procedure for an LLM agent

### 1. Confirm the target vault

Confirm the vault root contains:

```text
AGENTS.md
MEMORY.md
.agentic-memory/LLMS.md
```

Read:

1. `AGENTS.md`
2. `.agentic-memory/LLMS.md`
3. `MEMORY.md`
4. `.agentic-memory/instructions/writing-memory.md`
5. `.agentic-memory/instructions/linking-and-maps.md`

Check `git status --short` before editing when practical.

### 2. Update the control plane

Update `.agentic-memory/LLMS.md`:

- set frontmatter `version: 0.3.0`
- add `USER.md`, `projects/`, project/user terms, project/user loading rules, and `cross-project-persistence.md` instruction routing
- update managed type rules to include `user` and `project`

Update `.agentic-memory/instructions/writing-memory.md`:

- add `USER.md` and `projects/` layer-choice guidance
- add project rules
- add `USER.md` rules
- add promotion criteria for repeated project observations

Update `.agentic-memory/instructions/linking-and-maps.md`:

- add `[[USER]]` and `[[projects/name]]` link conventions
- clarify maps as high-level framing surfaces
- define maps versus projects
- add project semantic-link guidance

Update `.agentic-memory/instructions/reflection.md`:

- add project review
- add `USER.md` review
- add promotion review
- update lift + decompose guidance for overloaded projects

Add `.agentic-memory/instructions/cross-project-persistence.md`.

### 3. Add templates

Add:

```text
.agentic-memory/templates/project.md
.agentic-memory/templates/user.md
```

Update the map and note templates if needed to mention project routing and promotion.

The repository-level `BOOTSTRAP.md` is the generic snippet to adapt into harness-specific files such as Pi `APPEND_SYSTEM.md`, Claude `CLAUDE.md`, or repo-level `AGENTS.md`; those adapter files are not required Agentic Memory content.

### 4. Add root user memory

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

### 5. Add projects directory

Create:

```text
projects/
```

Add `.gitkeep` if the directory is empty.

### 6. Update `MEMORY.md`

Add a dedicated Projects section when the vault has active, recurring, umbrella, or important project-candidate routes.

Example:

```md
## Projects

- [[projects/example-project]] — current project state and routing. Read when: resuming this project.
```

Do not list every project if a parent project or map is a better route.

### 7. Identify initial project candidates

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

### 8. Promote repeated observations conservatively

Look for repeated project observations that should become atomic notes or `USER.md` entries.

Promote only when the observation is:

- repeated across two or more projects or many sessions
- useful beyond the source project
- not cheaply re-derived from project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or clearly marked as inferred / lower-confidence
- better represented once than duplicated in projects

If unsure, leave the observation in a project file as `Observed` or `Inferred` and note the open question.

### 9. Create a migration record

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

- `.agentic-memory/LLMS.md` declares `version: 0.3.0`.
- `USER.md` exists and uses `type: user`.
- `projects/` exists.
- `.agentic-memory/templates/project.md` exists.
- `.agentic-memory/templates/user.md` exists.
- `.agentic-memory/instructions/cross-project-persistence.md` exists.
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
