---
type: schema
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Architecture of Agentic Memory.
---

# Architecture

Agentic Memory is a small, composable memory system for AI agents.

The architecture optimizes for:

- low context-window cost
- human-readable Markdown
- Obsidian compatibility
- local-first ownership
- graph navigation through semantic links
- future migration through a stable filesystem and metadata contract

## Core model

Agentic Memory has five practical parts:

1. **Core memory** — `MEMORY.md`
   - Always-loaded summary and root MOC.
   - Contains high-signal context and links to routing MOCs.
   - Must stay small.

2. **MOCs** — `mocs/*.md`
   - Navigation notes / maps of content.
   - They route agents to the smallest relevant set of notes.
   - They are not content dumps.

3. **Atomic notes** — `notes/*.md`
   - Zettels / durable leaf nodes in the graph.
   - Each note captures one reusable idea, decision, pattern, question, or concept.
   - Notes mature from `seedling` to `budding` to `evergreen`.

4. **Sources** — `sources/*.md`
   - Immutable captured evidence.
   - Raw source material, reflection summaries, or source-like records.
   - Not loaded by default.

5. **Outputs** — `outputs/*.md`
   - Durable artifacts produced from the memory system.
   - Examples: answers, specs, handoffs, briefings, migration reports.

## Required vault layout

```text
memory/
├── AGENTS.md
├── MEMORY.md
├── MEMORY_SYSTEM.md
├── instructions/
│   ├── README.md
│   ├── operating-model.md
│   ├── writing-memory.md
│   ├── linking-and-mocs.md
│   └── reflection.md
├── mocs/
├── notes/
├── sources/
├── outputs/
└── templates/
```

All folders are flat by default. Use MOCs and links for structure instead of deep folder hierarchy.

## Progressive disclosure

Agents should load memory in this order:

1. `AGENTS.md`
2. `MEMORY.md`
3. relevant instruction file, if needed
4. relevant MOC
5. specific atomic notes
6. outputs, only when needed
7. sources, only for verification or ingestion

The system should make it possible to answer most routing questions from `MEMORY.md` plus one MOC.

## Graph shape

- `MEMORY.md` is the root navigation node.
- MOCs are internal navigation nodes.
- Atomic notes are leaf knowledge nodes.
- Atomic notes connect to other atomic notes using semantic links inspired by the Idea Compass.
- Sources and outputs are referenced by notes and MOCs but are not default context.

## Design constraints

- Keep the system simple enough to migrate.
- Prefer links over categories.
- Prefer frontmatter over hidden tool state.
- Prefer small files over sprawling notes.
- Prefer reflection and compaction over endless accumulation.
