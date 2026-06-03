---
version: 0.3.0
---

# Agentic Memory LLM Instructions

This file is the local system contract and LLM entrypoint for this Agentic Memory vault. It is part of the `.agentic-memory/` control plane, not active memory content.

Read this file before meaningful vault work. Then load only the optional instruction files and memory content needed for the task.

## Purpose

Agentic Memory is a small, Markdown-based memory system for AI agents. It uses progressive disclosure, user memory, project memory, memory maps, atomic notes, people notes, sources, records, and Git-auditable changes to preserve useful context without loading the whole vault.

## Required structure

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

## Terms

- **Core memory**: `MEMORY.md`; always-loaded memory and root memory map.
- **User memory**: `USER.md`; always-loaded, lean, pointer-heavy owner context for stable facts, communication preferences, glossary terms, and inferred preferences.
- **Memory map**: conceptual/domain framing note in `maps/` that tells agents what to read and when.
- **Project**: durable state and routing note in `projects/` for a recurring effort, project candidate, active project, completed project, archived project, or umbrella effort.
- **Atomic note**: focused note in `notes/` containing one durable idea, preference, pattern, heuristic, decision, question, or concept.
- **Person note**: durable context in `people/` about a specific person other than the vault owner who is meaningfully relevant to projects, collaborations, preferences, or recurring context.
- **Source**: immutable captured evidence in `sources/`.
- **Record**: append-stable recall summary in `records/` describing work, decisions, sessions, migrations, handoffs, or Reflection.
- **Control plane**: `.agentic-memory/`; LLM-facing system contract, instructions, and templates.
- **Reflection**: manual maintenance workflow for graph health, compaction, promotion, and usage-pattern learning.

## Loading order

1. `AGENTS.md`
2. `.agentic-memory/LLMS.md`
3. `MEMORY.md`
4. `USER.md`
5. optional instruction files routed below
6. relevant memory map from `maps/` or project from `projects/`
7. specific atomic notes from `notes/`, people notes from `people/`, or related projects
8. records or sources only when needed

## Progressive disclosure

Load the smallest useful context:

1. core memory in `MEMORY.md`
2. owner context in `USER.md`
3. relevant memory map or project file
4. specific atomic note, project, or person note
5. record or source only if needed

Do not load entire folders by default.

## Optional instruction routing

- `.agentic-memory/instructions/writing-memory.md` — persistence rules, layer choice, `MEMORY.md`/`USER.md` management, frontmatter formatting, project rules, and file maintenance. Read when: creating or editing memory files.
- `.agentic-memory/instructions/linking-and-maps.md` — memory-map routing links, project routing, vault-root-relative link rules, semantic-linking rules, and people-note routing. Read when: creating maps, creating projects, creating notes, creating people notes, adding links, or evaluating maturity.
- `.agentic-memory/instructions/cross-project-persistence.md` — proactive persistence rules for agents working in external projects and updating this vault as durable memory. Read when: working outside the vault, updating project memory, creating project candidates, or promoting repeated observations.
- `.agentic-memory/instructions/reflection.md` — manual Reflection workflow for graph health and usage feedback. Read when: running Reflection, compaction, pruning analysis, lift + decompose analysis, project/user cleanup, people-note cleanup, or session-usage review.

## Reading rules

- Use progressive disclosure.
- Prefer routing surfaces before detailed notes.
- Read summaries and `Read when:` clauses before opening linked files.
- Use vault-root-relative wikilinks for memory content, such as `[[USER]]`, `[[maps/name]]`, `[[projects/name]]`, `[[notes/name]]`, `[[people/name]]`, `[[sources/name]]`, and `[[records/name]]`.
- Do not load all notes just because they exist.
- Treat `USER.md` as durable owner context, not a place for unbounded biography or speculation.
- Treat project files as current-state routing surfaces, not full histories or source-code summaries.
- Treat people notes as durable collaborator/contact context, not a place for speculation.
- Treat sources as evidence, not default context.
- Treat records as compact recall summaries, not full artifacts.
- Do not route memory maps to `.agentic-memory/` control-plane files.

## Writing rules

Use the smallest correct memory layer:

- `MEMORY.md` — cross-cutting core memory, root routing, and active project routes.
- `USER.md` — lean durable owner facts, communication preferences, glossary meanings, and inferred preferences.
- `maps/` — conceptual/domain framing and navigation.
- `projects/` — durable recurring effort state, goals, decisions, open loops, and project-specific routing.
- `notes/` — atomic durable ideas, preferences, patterns, heuristics, decisions, and reusable knowledge.
- `people/` — durable context about specific people other than the vault owner.
- `sources/` — immutable captured evidence.
- `records/` — append-stable summaries of work, decisions, sessions, migrations, handoffs, or Reflection.

Edit `.agentic-memory/` only when changing how the memory system works.

Use `.agentic-memory/templates/` as scaffolds when creating new memory files; templates are not memory content.

Prefer updating existing files over creating duplicates.

## Managed file rules

- Managed memory types are only `core`, `user`, `map`, `project`, `note`, `person`, `source`, and `record`.
- Managed Markdown files use Obsidian-compatible YAML frontmatter; read `.agentic-memory/instructions/writing-memory.md` for the canonical formatting rules.
- Control-plane files under `.agentic-memory/` do not use managed memory `type` frontmatter.
- Filenames in folders use kebab-case.
- Root files `MEMORY.md` and `USER.md` are uppercase exceptions.
- Folders are flat by default.
- `MEMORY.md` is core memory and root memory map.
- `USER.md` is owner memory and should stay lean and pointer-heavy.
- Memory content links use vault-root-relative wikilinks, such as `[[USER]]`, `[[maps/name]]`, `[[projects/name]]`, `[[notes/name]]`, `[[people/name]]`, `[[sources/name]]`, and `[[records/name]]`.
- Memory-map and project routing links use root-relative paths: `[[notes/name]] — description. Read when: condition.`
- Maps should frame high-level concepts/domains and route to supporting notes, projects, people, records, and sources.
- Projects should capture durable effort state and routing, not facts cheaply derived from project files.
- Maps should not route to control-plane files.
- Atomic notes and projects include semantic links; read `.agentic-memory/instructions/linking-and-maps.md` for the canonical semantic-link rules.
- People notes are created only for people with durable relevance to projects, collaborations, preferences, or recurring context.
- Sources are immutable after capture.
- Records are append-stable recall summaries, not full artifact storage.
- The vault is assumed to be Git-backed, but agents do not commit automatically.

## Promotion and DRY memory

Project-specific observations should be promoted into atomic notes or `USER.md` when they repeat across projects or become useful beyond their originating project.

Use `notes/` for reusable principles, workflows, prompting patterns, technical rationale, and decision heuristics. Use `USER.md` for stable owner facts, communication preferences, glossary meanings, and compact links to detailed user-pattern notes.

After promotion, link project files to the new source of truth instead of duplicating the same wording.

## Authorship and trust

- Preserve human authorship and intent.
- Keep source material distinct from agent synthesis.
- Mark uncertainty explicitly in visible prose.
- Do not silently convert an agent proposal into accepted user direction.
- Do not infer sensitive traits or private facts about people without explicit evidence.
- Label user observations as explicit, repeated, observed, or inferred when confidence matters.
- If memory conflicts with current evidence, current evidence wins.

## Local deviations

None yet.

## Migration notes

Record future migrations here.

## Session close

Before finishing substantial work:

- decide whether any durable memory should be saved
- identify the relevant project, umbrella project, or project candidate
- update the smallest correct file
- promote repeated project observations into notes or `USER.md` when appropriate
- update `updated` dates on material edits
- ensure memory maps and project routes still route correctly
- summarize changes clearly
- check Git status when practical
- do not commit automatically
