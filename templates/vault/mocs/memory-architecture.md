---
type: moc
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Routing map for Agentic Memory architecture concepts.
---

# Memory Architecture

Use this MOC to understand the local memory-system design.

## Concepts

- [[progressive-disclosure]] — load memory from broad routing surfaces toward specific leaves only as needed. Read when: deciding how much memory context to load.
- [[mocs-as-routing-surfaces]] — MOCs are agent-readable navigation maps, not content dumps. Read when: creating or refactoring a MOC.
- [[atomic-notes-as-graph-leaves]] — atomic notes are the smallest durable knowledge units in the memory graph. Read when: creating, splitting, merging, or evaluating notes.

## System contract

- [[MEMORY_SYSTEM]] — local version, folder, and schema contract. Read when: checking compliance or preparing migration.
