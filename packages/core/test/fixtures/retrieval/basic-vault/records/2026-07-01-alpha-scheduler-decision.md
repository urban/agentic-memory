---
type: record
status: active
created: 2026-07-02
updated: 2026-07-02
record_type: decision
summary: "Accepted the Alpha Product 200ms p95 retry scheduler latency budget."
aliases:
  - "2026-07-01 Alpha Scheduler Decision"
sources:
  - "[[sources/2026-07-01-alpha-scheduler-source]]"
---

# 2026-07-01 Alpha Scheduler Decision

On 2026-07-01, Alpha Product accepted a **200ms p95 latency budget** for interactive retry scheduling.

This mattered because retry scheduling happens inside user-facing flows. The team rejected the Beta Platform 5 second batch retry window for Alpha Product because Alpha Product is interactive.
