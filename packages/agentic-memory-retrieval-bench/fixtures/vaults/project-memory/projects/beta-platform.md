---
type: project
status: active
project_status: active
created: 2026-07-02
updated: 2026-07-02
summary: "Distractor Beta Platform project for retrieval evaluation."
aliases:
  - "Beta Platform"
tags: []
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with:
  - "[[projects/alpha-product]]"
---

# Beta Platform

## Purpose

Beta Platform is a distractor fixture. Its retry policy should not be selected for Alpha Product prompts.

## Resume context

Beta Platform uses background batch retries where throughput matters more than responsiveness.

## Active goals

- Keep batch retry processing stable.

## Project timeline

- 2026-07-01: Added distractor retry policy.

## Decision log

- Decision: Use a 5 second batch retry window for Beta Platform.
  Rationale: Beta Platform is not interactive.

## Open questions

- None for the fixture.

## Next useful context

Do not use this project for Alpha Product prompts.

## Routing

- [[notes/beta-retry-policy]] — distractor batch retry policy. Read when: the prompt explicitly mentions Beta Platform.
