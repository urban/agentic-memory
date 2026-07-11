# Agentic Memory Retrieval Bench

Private workspace package for black-box Agentic Memory recall evaluation.

This package is the first feedback loop for future `agentic-memory search`, `query`, and `get` work. It tests the public `agentic-memory recall` behavior against synthetic fixture vaults before production retrieval ranking is tuned.

## Run it

From the repository root:

```sh
bun --filter='@urban/agentic-memory-retrieval-bench' run test
```

Run package lint, typecheck, and tests:

```sh
bun --filter='@urban/agentic-memory-retrieval-bench' run check
```

Run the full monorepo validation:

```sh
bun run check
```

## What it tests today

The current vertical slice runs nine end-to-end benchmark cases against `fixtures/basic-vault/` by invoking:

```sh
agentic-memory recall "<question>" --vault <fixture-vault> --json
```

The fixtures cover Alpha-only, Beta-only, user-preference-only, combined, unknown-project, off-topic, source policy, status demotion, route-to-note and route-to-record discovery, project decision/resume sections, root routes, and map framing. Cases that set `includeSources: true` invoke recall with `--include-sources`; all other cases use curated memory only.

The hard gates assert that recall:

- exits with code `0` for both `answered` and `not_found`
- emits stdout that decodes as `RecallSuccessJson`
- returns the status expected by each case
- includes every case-specific required fact
- excludes competing-project and unrelated preference facts

It does **not** inspect internal retrieval candidates, internal file names, or aggregate metrics yet. Metrics such as Recall@K, MRR, nDCG, latency, layer accuracy, and duplicate crowding are intentionally later phases.

## Why this exists

Agentic Memory retrieval should preserve the vault model instead of becoming generic document search. The benchmark exists to make retrieval changes measurable before adding QMD-backed search/query/get commands or tuning Agentic Memory ranking.

The first suite focuses on behavior that should remain stable across retrieval providers:

- the public CLI should answer from the fixture vault without exposing implementation details
- project-specific distractors should be excluded from the answer
- user preferences should be discoverable through the public recall answer
- answer-level behavior should stay stable even if internal retrieval changes

## Package layout

```text
fixtures/
  basic-vault/      Synthetic Agentic Memory vault with Alpha/Beta distractors
  queries.json      Gold benchmark cases
src/
  BenchmarkCase.ts  Case schema and fixture loader
  BenchmarkRunner.ts
  HardGates.ts      Initial pass/fail hard gates for CLI output
  RetrievalProvider.ts
  providers/
    LexicalProvider.ts
test/
  retrieval-bench-e2e.test.ts
```

## Lower-level providers

`LexicalProvider` remains available for lower-level retrieval experiments. It does not require QMD, embeddings, model downloads, or external services.

Future providers can implement the same retrieval provider shape, for example:

- static/fake provider for schema tests
- QMD lexical provider
- QMD hybrid/query provider for opt-in local evaluation

## Adding the next vertical slice

Prefer small increments:

1. Add or update a fixture case in `fixtures/queries.json`.
2. Add only the minimum fixture vault content needed to make the case meaningful.
3. Extend hard gates only if the new behavior is a deterministic pass/fail requirement.
4. Add metrics later as report fields, not as the first slice.

When production retrieval work starts, benchmark failures should be captured here before ranking weights or graph behavior are changed.
