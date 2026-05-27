---
type: agent
status: active
created: 2026-05-26
updated: 2026-05-26
summary: Local instructions for MOC routing links and atomic-note semantic links.
---

# Linking and MOCs

## MOC link format

Every routing link in a MOC must use:

```md
- [[target]] — description. Read when: condition.
```

This lets agents decide whether to load the linked file.

## Atomic note semantic links

Atomic notes use Idea Compass links in frontmatter:

```yaml
links:
  comes_from: []
  similar_to: []
  leads_to: []
  competes_with: []
```

They also include body explanations:

```md
## Semantic links

### Comes from
- [[source-idea]] — explanation. Read when: condition.
```

`Read when:` is required in MOCs and recommended for atomic-note links that guide future loading.

## Maturity target

Atomic notes should mature toward `evergreen` and ideally have 3+ meaningful semantic links.

Weakly connected notes are graph debt and should be revisited during Reflection.
