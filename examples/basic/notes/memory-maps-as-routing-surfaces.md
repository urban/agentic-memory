---
type: note
status: active
maturity: budding
created: 2026-05-27
updated: 2026-06-02
summary: "Memory maps frame a high-level concept and route agents through supporting notes and projects."
aliases:
  - "Memory Maps as Routing Surfaces"
sources: []
comes_from:
  - "[[notes/progressive-disclosure]]"
similar_to:
  - "[[projects/agentic-memory-example]]"
leads_to:
  - "[[notes/atomic-notes-as-knowledge-units]]"
competes_with: []
---

# Memory Maps as Routing Surfaces

A memory map is an agent-readable framing and routing surface. It should capture the high-level concept that makes linked notes and projects belong together, then tell an agent what a linked file contains and when to read it.

## Use when

- Creating or refactoring a memory map.
- Deciding whether a routing surface has enough context for progressive disclosure.
- Separating domain framing from project-specific state.

Memory maps should use this format:

```md
- [[notes/target]] — description. Read when: condition.
- [[projects/target-project]] — description. Read when: condition.
```

This makes navigation explicit and keeps maps from becoming content dumps. If the file needs active goals, current state, or next useful context, use a project file instead.

> [!info] Semantic links
>
> **Comes from**:
>
> - [[notes/progressive-disclosure]] — routing links are useful because agents should load memory in stages. Read when: deciding how much context to load.
>
> **Similar to**:
>
> - [[projects/agentic-memory-example]] — projects can route too, but they also track effort-specific state. Read when: comparing maps to projects.
>
> **Leads to**:
>
> - [[notes/atomic-notes-as-knowledge-units]] — maps are useful when the notes beneath them stay atomic. Read when: creating note structure.
>
> **Competes with**:
