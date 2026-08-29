---
type: core
status: active
created: 2026-07-02
updated: 2026-07-02
summary: "Root memory map for retrieval evaluation fixtures."
aliases:
  - "Memory"
---

# MEMORY

This fixture vault tests prompt-relative retrieval across projects, notes, records, sources, and user preferences.

## Root routes

- [[maps/alpha-product]] — Alpha Product routing for scheduler, latency, and user-facing planning context. Read when: working on Alpha Product scheduling or latency decisions.

## Projects

- [[projects/alpha-product]] — active Alpha Product fixture project. Read when: the prompt mentions Alpha Product, retry scheduling, or latency budget decisions.
- [[projects/beta-platform]] — distractor project for batch retry policy. Read when: the prompt explicitly mentions Beta Platform.
