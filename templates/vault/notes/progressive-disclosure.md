---
type: note
status: active
maturity: budding
created: 2026-05-26
updated: 2026-05-26
summary: Progressive disclosure keeps agent context small by loading memory in stages.
sources: []
links:
  comes_from:
    - "[[mocs-as-routing-surfaces]]"
  similar_to: []
  leads_to:
    - "[[atomic-notes-as-graph-leaves]]"
  competes_with: []
---

# Progressive Disclosure

Progressive disclosure means agents load only the smallest useful amount of memory: core memory first, then a relevant MOC, then only the atomic notes or sources needed for the task.

This keeps the context window available for current work instead of filling it with stale or irrelevant memory.

## Semantic links

### Comes from
- [[mocs-as-routing-surfaces]] — MOCs provide the routing layer that makes staged loading possible. Read when: designing memory navigation.

### Leads to
- [[atomic-notes-as-graph-leaves]] — progressive disclosure depends on small leaf notes that can be loaded individually. Read when: deciding note granularity.
