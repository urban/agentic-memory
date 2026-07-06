# Agentic Memory Retrieval Bench

Private workspace package for deterministic Agentic Memory retrieval evaluation.

This package is the first feedback loop for future `agentic-memory search`, `query`, and `get` work. It tests retrieval behavior against synthetic fixture vaults before production retrieval ranking is tuned.

## Run it

From the repository root:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run test
```

Run package lint, typecheck, and tests:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run check
```

Run the full monorepo validation:

```sh
bun run check
```

## What it tests today

The current vertical slice runs one end-to-end benchmark case against `fixtures/basic-vault/` using the deterministic lexical baseline provider.

The fixture asks a combined project/user-preference question:

> In Alpha Product, I need to tune the retry scheduler. What latency budget decision should I follow, and how should I present options back to Urban?

The initial hard gates assert that retrieval:

- returns required files:
  - `projects/alpha-product.md`
  - `notes/alpha-latency-budget.md`
  - `USER.md`
- does not return distractors:
  - `projects/beta-platform.md`
  - `notes/beta-retry-policy.md`
- does not leak `sources/` by default
- returns `projects/alpha-product.md` as preferred top-1
- returns vault-relative managed-memory paths

It does **not** score aggregate metrics yet. Metrics such as Recall@K, MRR, nDCG, latency, layer accuracy, and duplicate crowding are intentionally later phases.

## Why this exists

Agentic Memory retrieval should preserve the vault model instead of becoming generic document search. The benchmark exists to make retrieval changes measurable before adding QMD-backed search/query/get commands or tuning Agentic Memory ranking.

The first suite focuses on behavior that should remain stable across retrieval providers:

- project/map route files should beat generic keyword matches
- curated memory should be searched before raw `sources/`
- project-specific distractors should be excluded
- user preferences in `USER.md` should be discoverable
- paths should stay vault-relative so agents can safely `get` or read files later

## Package layout

```text
fixtures/
  basic-vault/      Synthetic Agentic Memory vault with Alpha/Beta distractors
  queries.json      Gold benchmark cases
src/
  BenchmarkCase.ts  Case schema and fixture loader
  BenchmarkRunner.ts
  HardGates.ts      Initial pass/fail hard gates
  RetrievalProvider.ts
  providers/
    LexicalProvider.ts
test/
  retrieval-bench-e2e.test.ts
```

## Current provider

`LexicalProvider` is a deterministic baseline provider for normal CI. It does not require QMD, embeddings, model downloads, or external services.

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
