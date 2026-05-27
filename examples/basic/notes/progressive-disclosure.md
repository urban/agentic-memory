---
type: note
status: active
maturity: budding
created: 2026-05-27
updated: 2026-05-27
summary: Progressive disclosure keeps agent context small by loading memory in stages.
sources: []
links:
  comes_from:
    - "[[notes/memory-maps-as-routing-surfaces]]"
  similar_to: []
  leads_to:
    - "[[notes/atomic-notes-as-knowledge-units]]"
  competes_with: []
---

# Progressive Disclosure

Progressive disclosure means agents load only the smallest useful amount of memory: core memory first, then a relevant memory map, then only the atomic notes, records, or sources needed for the task.

## Use when

- Deciding how much memory context to load.
- Refactoring memory that is too large or too eagerly loaded.

This keeps the context window available for current work instead of filling it with stale or irrelevant memory.

## Semantic links

### Comes from

- [[notes/memory-maps-as-routing-surfaces]] — maps provide the routing layer that makes staged loading possible. Read when: designing memory navigation.

### Leads to

- [[notes/atomic-notes-as-knowledge-units]] — progressive disclosure depends on small notes that can be loaded individually. Read when: deciding note granularity.
