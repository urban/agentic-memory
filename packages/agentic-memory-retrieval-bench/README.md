# Agentic Memory Retrieval Bench

Private workspace package for evaluating the public `agentic-memory recall` command against a synthetic Agentic Memory vault.

## Run it

From the repository root, run the test suite:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run test
```

Run the reportable benchmark in human-readable or JSON mode:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench
bun --filter='./packages/agentic-memory-retrieval-bench' run bench -- --json
```

Run all package checks:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run check
```

Run the full repository validation:

```sh
bun run check
```

## What it evaluates

The benchmark runs recall cases against a synthetic vault by invoking:

```sh
agentic-memory recall "<question>" --vault <fixture-vault> --json
```

Cases cover:

- project-specific facts and competing-project distractors
- user preferences and combined questions
- unknown and unrelated questions
- default recall and explicit `--include-sources` recall
- current facts when conflicting historical facts exist
- rationale and work-resumption questions
- consistent answers when facts appear more than once

Each case verifies that recall:

- exits successfully
- emits valid public recall JSON
- returns the expected `answered` or `not_found` status
- includes all required facts
- excludes forbidden or competing facts

The benchmark exits with a nonzero status when any case fails. In JSON mode, stdout contains only the benchmark report and failure diagnostics are written to stderr.

## Adding a benchmark case

1. Add the case to `fixtures/queries.json`.
2. Add only the fixture memory needed by the case to `fixtures/basic-vault/`.
3. Specify the expected status, required answer facts, and forbidden answer facts.
4. Run the package test and benchmark commands.
