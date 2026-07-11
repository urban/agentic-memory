---
type: note
status: active
maturity: budding
created: 2026-07-02
updated: 2026-07-02
summary: "Alpha Product interactive retry scheduling should use a 200ms p95 latency budget."
aliases:
  - "Alpha Latency Budget"
tags: []
sources:
  - "[[sources/2026-07-01-alpha-scheduler-source]]"
comes_from:
  - "[[projects/alpha-product]]"
similar_to: []
leads_to: []
competes_with:
  - "[[notes/beta-retry-policy]]"
---

# Alpha Latency Budget

Alpha Product interactive retry scheduling should use a **200ms p95 latency budget**. This budget applies when a retry decision blocks or influences a user-facing flow.

The decision favors perceived responsiveness over batch throughput.

## Use when

Use this note when tuning Alpha Product retry scheduler timing, choosing retry backoff defaults, or answering prompts about Alpha Product latency constraints.
