---
type: note
status: active
maturity: budding
created: 2026-05-26
updated: 2026-05-26
summary: MOCs route agents through the memory graph with descriptions and read conditions.
sources: []
links:
  comes_from:
    - "[[progressive-disclosure]]"
  similar_to: []
  leads_to:
    - "[[atomic-notes-as-graph-leaves]]"
  competes_with: []
---

# MOCs as Routing Surfaces

A Map of Content is an agent-readable routing surface. It should tell an agent what linked file contains and when to read it.

MOCs should use this format:

```md
- [[target]] — description. Read when: condition.
```

This makes navigation explicit and keeps MOCs from becoming content dumps.

## Semantic links

### Comes from
- [[progressive-disclosure]] — routing links are useful because agents should load memory in stages. Read when: deciding how much context to load.

### Leads to
- [[atomic-notes-as-graph-leaves]] — MOCs are useful when the notes beneath them stay atomic. Read when: creating note structure.
