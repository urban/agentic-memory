# Agentic Memory Recall Benchmark

This private workspace package is the canonical Batch 2 feedback loop for the public `agentic-memory recall` CLI. It treats Recall as a black box and runs one indivisible 16-case suite against two freshly initialized and indexed synthetic fixture vaults.

## Live workflows

Create or atomically replace the one Git-reviewed baseline:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench -- --update
```

Compare a complete new run with the compatible baseline:

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench
```

Add `--json` to either command for one schema-validated stdout document. Diagnostics go to stderr. No partial, fixture-specific, filtered, tagged, or external-vault runs are supported.

Live runs require the configured local Qwen synthesis server, the local embedding model, and an authenticated Pi `openai-codex` subscription. Semantic judgments are isolated one-shot Pi calls pinned to `openai-codex/gpt-5.6-sol` with high reasoning; sessions, tools, context files, extensions, skills, and prompt templates are disabled.

## Deterministic validation

Normal tests use fake Recall and judge adapters. They do not load embedding or synthesis models, contact Pi, or require network access:

```sh
bun run test packages/agentic-memory-retrieval-bench/test
bun run check
```

The live proof is intentionally opt-in and is not part of normal CI.

## Failure-to-regression workflow

1. Reduce the real miss to the smallest non-private synthetic memory.
2. Add or revise content in one of the two existing fixture overlays.
3. Add or revise a canonical case with an authoritative reference answer or `not_found` expectation.
4. Review the corpus-fingerprint change.
5. Run the full suite with `--update` and commit the corpus and reviewed baseline together.
6. Change Recall only in its owning package; keep the benchmark expectation fixed.
7. Run the full comparison and review every case and aggregate delta.
8. After accepting the behavior, run `--update` again and review the Git diff.

Operational failures never become Incorrect scores and never partially update the baseline. Pure judgment regressions are advisory; deterministic status and forbidden-fact violations retain a nonzero exit.
