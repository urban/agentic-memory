# Architecture

Agentic Memory is a small, composable memory system for AI agents.

The architecture optimizes for:

- low context-window cost
- human-readable Markdown
- Obsidian compatibility
- local-first ownership
- graph navigation through memory maps and semantic links
- future migration through a stable filesystem and metadata contract

## Two planes

An Agentic Memory vault separates user-visible memory from LLM-facing system files.

### Memory content plane

The content plane contains files a human may browse in Obsidian:

- `MEMORY.md`
- `maps/`
- `notes/`
- `sources/`
- `records/`

### LLM control plane

The control plane lives in a hidden folder:

```text
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
```

The control plane stores the local version contract, version-specific agent instructions, and scaffolds agents can use when creating new files. It is not ordinary memory content.

## Core model

Agentic Memory has five practical content parts:

1. **Core memory** — `MEMORY.md`
   - Always-loaded summary and root memory map.
   - Contains high-signal context and links to top-level memory maps.
   - Must stay small.

2. **Memory maps** — `maps/*.md`
   - Navigation notes that route agents to relevant context.
   - They help agents decide what to read next.
   - They are not content dumps.

3. **Atomic notes** — `notes/*.md`
   - The smallest durable knowledge units.
   - Each note captures one reusable idea, decision, pattern, question, or concept.
   - Notes mature from `seedling` to `budding` to `evergreen`.

4. **Sources** — `sources/*.md`
   - Immutable captured evidence.
   - Raw source material or source-like records.
   - Not loaded by default.

5. **Records** — `records/*.md`
   - Compact recall summaries of work, decisions, handoffs, migrations, sessions, or Reflection runs.
   - Records describe what happened, why, how, and what mattered.
   - They do not store full artifacts by default.

## Required vault layout

```text
memory/
├── AGENTS.md
├── MEMORY.md
├── .agentic-memory/
│   ├── LLMS.md
│   ├── instructions/
│   │   ├── writing-memory.md
│   │   ├── linking-and-maps.md
│   │   └── reflection.md
│   └── templates/
│       ├── map.md
│       ├── note.md
│       ├── record.md
│       ├── reflection-record.md
│       └── source.md
├── maps/
├── notes/
├── sources/
└── records/
```

Content folders are flat by default. Use memory maps and links for structure instead of deep folder hierarchy.

`template/` starts with empty `maps/`, `notes/`, `sources/`, and `records/` folders. See `examples/basic/` for reference content.

## Progressive disclosure

Agents should load memory in this order:

1. `AGENTS.md`
2. `.agentic-memory/LLMS.md`
3. `MEMORY.md`
4. optional instruction files routed from `LLMS.md`
5. relevant memory map
6. specific atomic notes
7. records, only when needed
8. sources, only for verification or ingestion

The system should make it possible to answer most routing questions from `MEMORY.md` plus one memory map.

## Navigation shape

- `MEMORY.md` is the root memory map.
- `maps/` contains topic-specific memory maps.
- Atomic notes are focused knowledge units that agents load after following routing links.
- Atomic notes connect to other atomic notes using semantic links.
- Sources and records are referenced by notes and maps but are not default context.

Memory maps may reference other memory maps, but depth should remain shallow:

- preferred: `MEMORY.md → map → note`
- acceptable: `MEMORY.md → map → map → note`
- depth 3 map chains are allowed only for large domains and should be reviewed
- depth greater than 3 requires an explicit local deviation in `.agentic-memory/LLMS.md`

## Design constraints

- Keep the system simple enough to migrate.
- Prefer links over categories.
- Prefer frontmatter over hidden tool state for managed memory files.
- Prefer small files over sprawling notes.
- Prefer Reflection and compaction over endless accumulation.
- Preserve the distinction between content memory and LLM control-plane instructions.
