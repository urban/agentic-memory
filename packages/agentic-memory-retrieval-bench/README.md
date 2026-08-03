# Agentic Memory Retrieval Bench

Private workspace package for evaluating the public `agentic-memory recall` command against a synthetic Agentic Memory vault.

## Deterministic package tests

The normal test suite uses a fake child-process subject that returns deterministic public Recall responses. It verifies CLI invocation, JSON decoding, hard gates, reports, failure handling, and disposable-vault orchestration without loading an embedding model, calling a synthesis model, or requiring a live server:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run test
```

`bun run check` includes these deterministic tests. Live answer quality is not a Slice 1 completion gate.

## Opt-in live quality benchmark

The `bench` script is separate follow-on quality work. It invokes the real public CLI and therefore requires the pinned local synthesis server, `AGENTIC_MEMORY_SYNTHESIS_URL`, and local embedding-model availability described in the repository's [local synthesis setup guide](../../docs/recall-local-synthesis-setup.md).

Run it explicitly in human-readable or JSON mode:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench
bun --filter='./packages/agentic-memory-retrieval-bench' run bench -- --json
```

Without `--vault`, the command initializes a disposable vault, overlays the synthetic fixture, builds its semantic index, and removes the generated vault after the run. Initialization may provision the embedding model when it is absent. Pass `--vault <path>` to benchmark an already initialized and indexed vault instead.

The live benchmark is not run by `bun run check`, is not required to complete Slice 1, and must not be used as a deterministic correctness test. Generated wording is not a product quality gate; the fixture's exact fact checks are benchmark policy for exploratory quality work.

Run all package checks:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run check
```

Run the full repository validation:

```sh
bun run check
```

## What the opt-in benchmark evaluates

The benchmark runs recall cases against a synthetic vault by invoking:

```sh
agentic-memory recall "<question>" --vault <fixture-vault> --json
```

Cases cover:

- project-specific facts and competing-project distractors
- singular user-preference questions in project-specific and general contexts
- unknown and unrelated questions
- source-only questions that must abstain under the source-free contract
- exploratory handling of current and historical distractors
- rationale and work-resumption questions
- consistent answers when facts appear more than once

Each case checks whether the live answer:

- exits successfully
- emits valid public recall JSON
- returns the expected `answered` or `not_found` status
- includes all required facts
- excludes forbidden or competing facts

The benchmark exits with a nonzero status when any case fails. In JSON mode, stdout contains only the benchmark report and failure diagnostics are written to stderr. A failure is quality evidence for follow-on work, not a Slice 1 completion failure.

## Adding a benchmark case

1. Add the case to `fixtures/queries.json`.
2. Add only the fixture memory needed by the case to `fixtures/basic-vault/`.
3. Specify the expected status, required answer facts, and forbidden answer facts.
4. Run the package test and benchmark commands.
