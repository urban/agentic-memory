---
version: 0.1.0
---

# Agentic Memory LLM Instructions

This file is the local system contract and LLM entrypoint for this Agentic Memory vault. It is part of the `.agentic-memory/` control plane, not active memory content.

Read this file before meaningful vault work. Then load only the optional instruction files and memory content needed for the task.

## Purpose

Agentic Memory is a small, Markdown-based memory system for AI agents. It uses progressive disclosure, memory maps, atomic notes, sources, records, and Git-auditable changes to preserve useful context without loading the whole vault.

## Required structure

```text
AGENTS.md
MEMORY.md
.agentic-memory/
├── LLMS.md
├── instructions/
│   ├── writing-memory.md
│   ├── linking-and-maps.md
│   └── reflection.md
└── templates/
    ├── map.md
    ├── note.md
    ├── record.md
    ├── reflection-record.md
    └── source.md
maps/
notes/
sources/
records/
```

## Terms

- **Core memory**: `MEMORY.md`; always-loaded memory and root memory map.
- **Memory map**: routing note in `maps/` that tells agents what to read and when.
- **Atomic note**: focused note in `notes/` containing one durable idea.
- **Source**: immutable captured evidence in `sources/`.
- **Record**: append-stable recall summary in `records/` describing work, decisions, sessions, migrations, handoffs, or Reflection.
- **Control plane**: `.agentic-memory/`; LLM-facing system contract, instructions, and templates.
- **Reflection**: manual maintenance workflow for graph health, compaction, and usage-pattern learning.

## Loading order

1. `AGENTS.md`
2. `.agentic-memory/LLMS.md`
3. `MEMORY.md`
4. optional instruction files routed below
5. relevant memory map from `maps/`
6. specific atomic notes from `notes/`
7. records or sources only when needed

## Progressive disclosure

Load the smallest useful context:

1. core memory in `MEMORY.md`
2. relevant memory map
3. specific atomic note
4. record or source only if needed

Do not load entire folders by default.

## Optional instruction routing

- `.agentic-memory/instructions/writing-memory.md` — persistence rules, layer choice, `MEMORY.md` management, and file maintenance. Read when: creating or editing memory files.
- `.agentic-memory/instructions/linking-and-maps.md` — memory-map routing links, vault-root-relative link rules, and atomic-note semantic-linking rules. Read when: creating maps, creating notes, adding links, or evaluating note maturity.
- `.agentic-memory/instructions/reflection.md` — manual Reflection workflow for graph health and usage feedback. Read when: running Reflection, compaction, pruning analysis, lift + decompose analysis, or session-usage review.

## Reading rules

- Use progressive disclosure.
- Prefer routing surfaces before detailed notes.
- Read summaries and `Read when:` clauses before opening linked files.
- Use vault-root-relative wikilinks for memory content, such as `[[maps/name]]` or `[[notes/name]]`.
- Do not load all notes just because they exist.
- Treat sources as evidence, not default context.
- Treat records as compact recall summaries, not full artifacts.
- Do not route memory maps to `.agentic-memory/` control-plane files.

## Writing rules

Use the smallest correct memory layer:

- `MEMORY.md` — cross-cutting core memory and root routing.
- `maps/` — routing and navigation.
- `notes/` — atomic durable ideas.
- `sources/` — immutable captured evidence.
- `records/` — append-stable summaries of work, decisions, sessions, migrations, handoffs, or Reflection.

Edit `.agentic-memory/` only when changing how the memory system works.

Use `.agentic-memory/templates/` as scaffolds when creating new memory files; templates are not memory content.

Prefer updating existing files over creating duplicates.

## Managed file rules

- Managed memory types are only `core`, `map`, `note`, `source`, and `record`.
- Managed Markdown files use YAML frontmatter.
- Control-plane files under `.agentic-memory/` do not use managed memory `type` frontmatter.
- Filenames use kebab-case.
- Folders are flat by default.
- `MEMORY.md` is core memory and root memory map.
- Memory content links use vault-root-relative wikilinks, such as `[[maps/name]]`, `[[notes/name]]`, `[[sources/name]]`, and `[[records/name]]`.
- Memory-map routing links use root-relative paths: `[[notes/name]] — description. Read when: condition.`
- Maps should not route to control-plane files.
- Atomic notes include semantic links in frontmatter and body.
- Sources are immutable after capture.
- Records are append-stable recall summaries, not full artifact storage.
- The vault is assumed to be Git-backed, but agents do not commit automatically.

## Authorship and trust

- Preserve human authorship and intent.
- Keep source material distinct from agent synthesis.
- Mark uncertainty explicitly in visible prose.
- Do not silently convert an agent proposal into accepted user direction.
- If memory conflicts with current evidence, current evidence wins.

## Local deviations

None yet.

## Migration notes

Record future migrations here.

## Session close

Before finishing substantial work:

- decide whether any durable memory should be saved
- update the smallest correct file
- update `updated` dates on material edits
- ensure memory maps still route correctly
- summarize changes clearly
- check Git status when practical
- do not commit automatically
