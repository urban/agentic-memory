# Agentic Memory v0.1.0 to v0.2.0 Migration

This is a manual/LLM-assisted migration from Agentic Memory `0.1.0` to `0.2.0`.

It is intentionally written as an instruction file that can be given to an LLM agent. The agent should perform the migration, verify the result, and leave changes for human review. Do not commit automatically.

## Purpose

Version `0.2.0` makes Agentic Memory more compatible with Obsidian Properties and adds first-class people notes.

The migration changes:

1. `version: 0.1.0` → `version: 0.2.0` in `.agentic-memory/LLMS.md`.
2. Frontmatter list formatting becomes Obsidian-compatible.
3. `summary` frontmatter values are quoted.
4. Every managed page gets at least one human-readable `aliases` value.
5. Atomic-note semantic-link frontmatter is flattened:
   - from nested `links.comes_from`, `links.similar_to`, `links.leads_to`, `links.competes_with`
   - to top-level `comes_from`, `similar_to`, `leads_to`, `competes_with`
6. Atomic-note body semantic-link sections are converted to a Markdown callout.
7. A `people/` directory is added for `type: person` notes.
8. The vault is analyzed for people who deserve durable person notes.

## Required target structure

After migration, the vault should have:

```text
AGENTS.md
MEMORY.md
.agentic-memory/
├── LLMS.md
├── instructions/
│   ├── writing-memory.md
│   ├── linking-and-maps.md
│   └── reflection.md
└── templates/
    ├── map.md
    ├── note.md
    ├── person.md
    ├── record.md
    ├── reflection-record.md
    └── source.md
maps/
notes/
people/
sources/
records/
```

## Canonical frontmatter rules

Use Obsidian-compatible YAML frontmatter for all managed memory files.

Rules:

- Use `aliases`, not deprecated `alias`.
- Every managed page must include at least one human-readable alias.
- Quote every `summary` value.
- Empty list properties such as `tags: []`, `sources: []`, and `similar_to: []` are acceptable.
- Non-empty list properties should use YAML block-list format.
- Internal links in frontmatter list values must be quoted.
- Do not use nested frontmatter properties.
- Atomic-note semantic links must be top-level list properties: `comes_from`, `similar_to`, `leads_to`, and `competes_with`.

Example:

```yaml
---
type: note
status: active
maturity: budding
created: 2026-05-27
updated: 2026-05-28
summary: "Progressive disclosure keeps memory context small."
aliases:
  - "Progressive Disclosure"
tags: []
sources:
  - "[[sources/example-source]]"
comes_from:
  - "[[notes/memory-maps-as-routing-surfaces]]"
similar_to: []
leads_to:
  - "[[notes/atomic-notes-for-agent-memory]]"
competes_with: []
---
```

## Scope

Migrate managed memory files in:

- `MEMORY.md`
- `maps/**/*.md`
- `notes/**/*.md`
- `people/**/*.md`, if already present
- `sources/**/*.md`
- `records/**/*.md`

Update control-plane files in:

- `.agentic-memory/LLMS.md`
- `.agentic-memory/instructions/*.md`
- `.agentic-memory/templates/*.md`

Do not treat `AGENTS.md` as a managed memory file. Do not add managed-memory frontmatter to `.agentic-memory/**` control-plane files.

## Safety rules

- Preserve human-authored meaning.
- Preserve `created` dates.
- Update `updated` dates when materially changing a managed memory file.
- Keep source material distinct from synthesis.
- Do not delete files without explicit human approval.
- Do not commit automatically.
- If uncertain whether a person note should be created, document the uncertainty instead of creating speculative memory.

## Procedure for an LLM agent

### 1. Orient and inspect

1. Confirm the vault root with the user or from context.
2. Read `AGENTS.md`, `.agentic-memory/LLMS.md`, and `MEMORY.md`.
3. Check Git status before editing.
4. Inspect relevant docs/templates if migrating from an Agentic Memory source repository.

Useful commands:

```bash
git status --short
find . -maxdepth 2 -type d | sort
find . -path './.git' -prune -o -name '*.md' -print | sort
```

### 2. Update the control plane

Update `.agentic-memory/LLMS.md`:

- set frontmatter `version: 0.2.0`
- add `people/` to required structure
- add `.agentic-memory/templates/person.md`
- describe `type: person`
- describe Obsidian-compatible frontmatter rules
- describe flattened semantic-link properties
- describe atomic-note callout format

Update `.agentic-memory/instructions/writing-memory.md`:

- add frontmatter formatting rules
- add people-note rules
- add `people/` to layer-choice guidance

Update `.agentic-memory/instructions/linking-and-maps.md`:

- include `[[people/name]]` link conventions
- allow memory maps to route to people notes
- replace nested semantic-link frontmatter examples with flattened properties
- replace body `## Semantic links` examples with the callout format

Update `.agentic-memory/instructions/reflection.md`:

- include people-note review
- flag speculative, missing, duplicated, or stale people notes

Update templates:

- update `note.md` to use flattened semantic-link frontmatter and callout body
- update all templates to quote `summary` and include `aliases`
- add `person.md`

### 3. Add `people/`

Create the directory if missing:

```bash
mkdir -p people
```

If the directory would otherwise be empty and the repository tracks empty folders with `.gitkeep`, add:

```text
people/.gitkeep
```

### 4. Normalize frontmatter in managed files

For each managed Markdown file, normalize the frontmatter.

#### All managed files

Ensure:

- `summary` exists and is quoted.
- `aliases` exists and has at least one human-readable value.
- no `alias` property remains; convert it to `aliases`.
- non-empty lists are block lists.
- frontmatter internal links are quoted.
- no nested frontmatter properties remain unless explicitly approved as a local deviation.

Alias selection:

1. Prefer the first H1 text.
2. Otherwise use an existing good alias.
3. Otherwise derive title case from the filename.

Example:

```yaml
aliases:
  - "Memory Maps as Routing Surfaces"
```

#### Atomic notes

For every `type: note` file, replace nested semantic-link frontmatter:

```yaml
links:
  comes_from:
    - "[[notes/source]]"
  similar_to: []
  leads_to: []
  competes_with: []
```

with flattened frontmatter:

```yaml
comes_from:
  - "[[notes/source]]"
similar_to: []
leads_to: []
competes_with: []
```

Preserve existing link values and order where practical.

### 5. Convert atomic-note body semantic links to callouts

For every `type: note` file, convert any old body section like this:

```md
## Semantic links

### Comes from

- [[notes/source]] — explanation. Read when: condition.

### Similar to

### Leads to

### Competes with
```

into this callout:

```md
> [!info] Semantic links
>
> **Comes from**:
>
> - [[notes/source]] — explanation. Read when: condition.
>
> **Similar to**:
>
> **Leads to**:
>
> **Competes with**:
```

Rules:

- Preserve link explanations.
- Preserve `Read when:` conditions when present.
- If a category has no links, leave just the category heading inside the callout.
- Do not convert unrelated `## Semantic links` headings outside atomic notes unless clearly part of the old atomic-note format.

### 6. Analyze for people notes

Analyze `MEMORY.md`, maps, notes, records, and relevant sources for people who deserve durable person notes.

Create a `people/` note only when the person is meaningfully relevant to durable memory, projects, collaborations, preferences, or recurring context.

Do not create person notes for:

- incidental names in raw sources
- citations or authors mentioned only as source metadata
- competitor-page names
- public figures mentioned only as examples
- historical captures where the person has no expected future relevance

When creating a person note, use:

```yaml
---
type: person
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
summary: "Short context about this person."
aliases:
  - "Person Name"
tags: []
sources: []
---

# Person Name

## Context

Who this person is and why they matter to durable memory.

## Preferences and communication style

Durable preferences only. Avoid speculation.

## Projects and associations

- [[maps/project-or-topic]] — relationship/context.

## Important facts

- Durable fact with source/context when needed.

## Open questions

- Unknowns worth clarifying.

## Related

- [[notes/example]] — why related.
```

If creating a person note makes an existing map more useful, add a routing link to the appropriate map:

```md
- [[people/person-name]] — collaboration context and durable preferences. Read when: preparing work involving Person Name.
```

### 7. Update memory maps where needed

Add or update routing links only when they improve progressive disclosure.

Rules:

- Use vault-root-relative wikilinks.
- Include a description and `Read when:`.
- Do not route maps to `.agentic-memory/**`.
- Do not add every new person note to `MEMORY.md`; route through the most relevant map unless the person is a top-level recurring route.

### 8. Create a migration record

For substantial vault migrations, create:

```text
records/YYYY-MM-DD-v0.1.0-to-v0.2.0-migration.md
```

Use `record_type: migration` and v0.2.0 frontmatter.

Include:

- what changed
- why it mattered
- files or file classes migrated
- people notes created, if any
- files intentionally left unchanged
- verification performed
- open follow-up questions

## Verification checklist

Run checks and inspect results. Use equivalent commands if the environment differs.

### Version and structure

```bash
rg -n "version: 0\.2\.0" .agentic-memory/LLMS.md
find .agentic-memory/templates -maxdepth 1 -type f | sort
find people -maxdepth 1 -type f | sort
```

Confirm:

- `.agentic-memory/LLMS.md` says `version: 0.2.0`.
- `.agentic-memory/templates/person.md` exists.
- `people/` exists.

### No nested semantic-link frontmatter

```bash
rg -n "^links:\s*$" MEMORY.md maps notes people sources records .agentic-memory || true
```

Expected: no `links:` frontmatter remains for managed atomic-note semantic links. If `links:` appears in prose examples, confirm it is not active managed-file frontmatter.

### Flattened atomic-note fields exist

```bash
rg -n "^(comes_from|similar_to|leads_to|competes_with):" notes .agentic-memory/templates/note.md
```

Confirm every `type: note` file has all four top-level semantic-link properties.

### Summaries are quoted

```bash
rg -n "^summary: [^\"']" MEMORY.md maps notes people sources records || true
```

Expected: no unquoted summaries. Manually inspect edge cases where a value is intentionally quoted with single quotes; double quotes are preferred.

### Aliases exist

```bash
rg --files-without-match -g '*.md' '^aliases:' MEMORY.md maps notes people sources records || true
```

Expected: no managed memory files without `aliases:`.

Then spot-check that aliases are human-readable and not empty.

### Deprecated alias property removed

```bash
rg -n '^alias:' MEMORY.md maps notes people sources records .agentic-memory || true
```

Expected: no deprecated `alias:` properties.

### Atomic-note body callouts

```bash
rg -n '^## Semantic links' notes || true
rg -n '^> \[!info\] Semantic links' notes
```

Expected:

- no old `## Semantic links` body sections remain in atomic notes
- atomic notes use the callout format

### Obsidian links in frontmatter lists are quoted

Inspect any frontmatter lists containing wikilinks and ensure they look like:

```yaml
sources:
  - "[[sources/example]]"
similar_to:
  - "[[notes/example]]"
```

A rough search for unquoted frontmatter wikilinks:

```bash
python3 - <<'PY'
from pathlib import Path
for p in [Path('MEMORY.md'), *Path('maps').rglob('*.md'), *Path('notes').rglob('*.md'), *Path('people').rglob('*.md'), *Path('sources').rglob('*.md'), *Path('records').rglob('*.md')]:
    if not p.exists() or not p.is_file():
        continue
    text = p.read_text(errors='ignore')
    if not text.startswith('---'):
        continue
    end = text.find('\n---', 3)
    if end == -1:
        continue
    fm = text[:end]
    for i, line in enumerate(fm.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith('- [['):
            print(f'{p}:{i}: {line}')
PY
```

Expected: no output.

### People-note quality

Manually inspect each `people/*.md` file.

Confirm:

- the person is durably relevant
- frontmatter uses `type: person`
- alias includes the person's human-readable name
- no sensitive or speculative claims were introduced
- uncertainty is explicit
- relevant maps route to the person note only when useful

### Git review

```bash
git status --short
git diff --stat
git diff -- .agentic-memory MEMORY.md maps notes people records sources
```

Summarize changes for the human. Do not commit unless explicitly instructed.

## Rollback advice

Because the vault is Git-backed, rollback should use Git review and checkout/reset as appropriate.

If only one file was incorrectly transformed, restore that file from Git and redo it manually.

If many files were incorrectly transformed, stop and ask the human whether to reset the branch or apply a targeted corrective migration.

## Success criteria

The migration is complete when:

- `.agentic-memory/LLMS.md` declares `version: 0.2.0`.
- The required `people/` directory exists.
- `.agentic-memory/templates/person.md` exists.
- Managed files use quoted summaries and `aliases`.
- Atomic-note semantic-link frontmatter is flat.
- Atomic-note body semantic links use the callout format.
- People notes exist only for durably relevant people discovered during analysis.
- Verification commands have been run or equivalent manual checks have been completed.
- A migration record exists for substantial migrations.
- Git status/diff have been summarized for human review.
