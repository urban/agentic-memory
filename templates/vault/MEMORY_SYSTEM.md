---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Local Agentic Memory system contract for this vault.
---

# Memory System

This vault implements Agentic Memory v1.

## Required structure

```text
AGENTS.md
MEMORY.md
MEMORY_SYSTEM.md
instructions/
mocs/
notes/
sources/
outputs/
templates/
```

## Local deviations

None yet.

## Loading order

1. `AGENTS.md`
2. `MEMORY_SYSTEM.md`
3. `MEMORY.md`
4. relevant file from `instructions/`
5. relevant MOC from `mocs/`
6. specific atomic notes from `notes/`
7. sources or outputs only when needed

## Managed file rules

- Managed Markdown files use YAML frontmatter.
- Filenames use kebab-case.
- Folders are flat by default.
- `MEMORY.md` is core memory and root MOC.
- MOC routing links use: `[[target]] — description. Read when: condition.`
- Atomic notes include Idea Compass semantic links in frontmatter and body.
- Sources are immutable after capture.
- The vault is assumed to be Git-backed.

## Migration notes

- Current version: Agentic Memory v1.
- Record future migrations here.
