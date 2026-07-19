---
type: project
status: active
project_status: active
created: 2026-07-02
updated: 2026-07-02
summary: "Active Alpha Product fixture project for retrieval evaluation."
aliases:
  - "Alpha Product"
tags: []
sources: []
comes_from:
  - "[[maps/alpha-product]]"
similar_to: []
leads_to: []
competes_with:
  - "[[projects/beta-platform]]"
---

# Alpha Product

## Purpose

Alpha Product is the active fixture project for testing project-aware memory retrieval.

## Resume context

Alpha Product uses an interactive retry scheduler. Future work should preserve responsiveness over throughput when the prompt concerns user-facing scheduling.

## Active goals

- Keep interactive retry scheduling under the accepted latency budget.

## Project timeline

- 2026-07-01: Accepted the Alpha scheduler latency decision.

## Decision log

- Decision: Use a **200ms p95 latency budget** for Alpha Product interactive retry scheduling.
  Rationale: Alpha Product retries happen inside user-facing flows, so responsiveness matters more than batch throughput.

## Open questions

- None for the fixture.

## Next useful context

Read [[notes/alpha-latency-budget]] before changing retry scheduler timing.

## Routing

- [[notes/alpha-latency-budget]] — accepted latency budget for Alpha retry scheduling. Read when: changing scheduler timing or retry behavior.
- [[records/2026-07-01-alpha-scheduler-decision]] — dated rationale. Read when: asking why the 200ms budget was chosen.
