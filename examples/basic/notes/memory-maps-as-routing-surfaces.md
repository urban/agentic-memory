---
type: note
status: active
maturity: budding
created: 2026-05-27
updated: 2026-05-27
summary: Memory maps route agents through the memory graph with descriptions and read conditions.
sources: []
links:
  comes_from:
    - "[[notes/progressive-disclosure]]"
  similar_to: []
  leads_to:
    - "[[notes/atomic-notes-as-knowledge-units]]"
  competes_with: []
---

# Memory Maps as Routing Surfaces

A memory map is an agent-readable routing surface. It should tell an agent what a linked file contains and when to read it.

## Use when

- Creating or refactoring a memory map.
- Deciding whether a routing surface has enough context for progressive disclosure.

Memory maps should use this format:

```md
- [[notes/target]] — description. Read when: condition.
```

This makes navigation explicit and keeps maps from becoming content dumps.

## Semantic links

### Comes from

- [[notes/progressive-disclosure]] — routing links are useful because agents should load memory in stages. Read when: deciding how much context to load.

### Leads to

- [[notes/atomic-notes-as-knowledge-units]] — maps are useful when the notes beneath them stay atomic. Read when: creating note structure.
