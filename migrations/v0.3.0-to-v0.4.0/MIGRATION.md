# Agentic Memory v0.3.0 to v0.4.0 Migration

This is a manual/LLM-assisted migration from Agentic Memory `0.3.0` to `0.4.0`.

It is intentionally written as an instruction file that can be given to an LLM agent. The agent should perform the migration, verify the result, and leave changes for human review. Do not commit automatically.

## Purpose

Version `0.4.0` adds a project-oriented capture contract for outside-vault Memory Steward flows, introduces the Agentic Memory CLI as the stable steward execution boundary, and tightens the expected shape of project memory.

The migration changes:

1. Replace the existing `.agentic-memory/` control plane with the `0.4.0` template control plane.
2. Ensure `.agentic-memory/LLM-vault-local.md` and `.agentic-memory/LLM-outside-vault.md` both declare `version: 0.4.0`.
3. Add `.agentic-memory/instructions/session-capture.md`.
4. Update `.agentic-memory/instructions/writing-memory.md` and `.agentic-memory/instructions/cross-project-persistence.md` for Memory Steward capture behavior.
5. Update project templates and existing `projects/*.md` files so they use `## Resume context`, `## Project timeline`, and `## Decision log`.
6. Clarify that project files are durable routing/state summaries, not issue trackers or daily work logs.
7. Move unreleased project link config terminology from `projectLink` to `projectSlug`; recreate any existing `.agentic-memory-link/config.json` files with `agentic-memory link`.
8. Treat `agentic-memory run-steward` as the stable steward execution boundary for harness adapters.

## Safety rules

- Preserve human-authored meaning.
- Preserve `created` dates on managed memory files.
- Update `updated` dates only on material edits.
- Do not rewrite project history into synthetic timelines; keep meaningful existing chronology and leave dense history in `records/`.
- Do not delete managed memory files without explicit human approval.
- Do not commit automatically.
- Do not preserve or migrate unreleased `projectLink` link configs automatically; recreate them with the CLI when needed.

## Procedure

### 1. Confirm the target vault

Confirm the vault root contains:

```text
AGENTS.md
MEMORY.md
.agentic-memory/
```

Read:

1. `AGENTS.md`
2. `MEMORY.md`
3. `USER.md`
4. existing `.agentic-memory/LLM-vault-local.md`
5. existing `.agentic-memory/LLM-outside-vault.md`
6. existing `.agentic-memory/instructions/writing-memory.md`
7. existing `.agentic-memory/instructions/cross-project-persistence.md`

Check `git status --short` before editing when practical.

### 2. Replace the control plane

Replace the target vault's `.agentic-memory/` directory with the `0.4.0` template control plane.

The replacement must include:

```text
.agentic-memory/LLM-vault-local.md
.agentic-memory/LLM-outside-vault.md
.agentic-memory/instructions/writing-memory.md
.agentic-memory/instructions/linking-and-maps.md
.agentic-memory/instructions/cross-project-persistence.md
.agentic-memory/instructions/session-capture.md
.agentic-memory/instructions/reflection.md
.agentic-memory/templates/project.md
```

Both LLM contract files must declare:

```yaml
---
version: 0.4.0
---
```

### 3. Update project files conservatively

For each durable `projects/*.md` file:

1. Preserve frontmatter.
2. Preserve the H1.
3. Ensure the body contains:
   - `## Resume context`
   - `## Project timeline`
   - `## Decision log`
4. Move existing "current state" content into `## Resume context`.
5. Move dated milestone/history content into `## Project timeline`.
6. Move durable decisions/rationale into `## Decision log`.
7. Leave dense task history in `records/` or keep it visible only when it is truly durable.

Do not force a full rewrite when a file already has equivalent sections; prefer minimal renames or targeted inserts.

### 4. Refresh outside-vault project links when needed

The unreleased Pi capture config shape used `projectLink`, for example:

```json
{
  "version": 1,
  "vaultPath": "/absolute/path/to/agentic-memory-vault",
  "projectLink": "[[projects/example-project]]"
}
```

The `0.4.0` CLI/core contract uses `projectSlug` instead:

```json
{
  "version": 1,
  "vaultPath": "/absolute/path/to/agentic-memory-vault",
  "projectSlug": "example-project"
}
```

Because `0.4.0` has not been released, do not build compatibility shims for the old config. For each external project that was initialized during development, rerun:

```sh
agentic-memory link --vault /absolute/path/to/agentic-memory-vault --project example-project
```

The `link` command should recreate `.agentic-memory-link/config.json`, ensure `projects/example-project.md` exists, and ensure `MEMORY.md` routes to `[[projects/example-project]]`.

### 5. Update routes and records only when needed

- Update `MEMORY.md` project routes only when the routing surface materially changes.
- Create a migration record only for substantial vault migrations or when the human wants a durable upgrade record.

## Verification checklist

- `.agentic-memory/LLM-vault-local.md` declares `version: 0.4.0`.
- `.agentic-memory/LLM-outside-vault.md` declares `version: 0.4.0`.
- `.agentic-memory/instructions/session-capture.md` exists.
- Project templates include `Resume context`, `Project timeline`, and `Decision log`.
- Existing durable project files use those sections or clearly equivalent minimal variants.
- No project file was turned into a chat log or issue tracker during migration.
- Any development-era `.agentic-memory-link/config.json` files have been recreated with `projectSlug` when still needed.
- Outside-vault capture setup uses `agentic-memory link` and steward execution uses `agentic-memory run-steward`.

## Recommended closeout

Summarize:

- changed files
- any project files that needed manual interpretation
- any project histories intentionally left in `records/`
- verification results
- open questions
- `git status --short`
