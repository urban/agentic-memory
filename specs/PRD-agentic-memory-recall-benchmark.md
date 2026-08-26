# PRD: Agentic Memory Recall Benchmark — Batch 2

## Status

Approved requirements. Human approval was recorded through Task Manager Ticket `5bfq31` after the Wayfinder interview and final document review. Batch 2 implementation has not started.

This document is the source of truth for the Batch 2 Recall benchmark foundation. It narrows and replaces the earlier broad benchmark-project draft. The Slice 1 Recall PRD remains authoritative for shipped Recall behavior.

## Summary

Build the leanest useful feedback loop for improving Recall quality:

```text
synthetic fixture vaults
+ complete question corpus with authoritative reference answers
→ real public Recall CLI responses
→ deterministic status and forbidden-fact checks
→ independent GPT-5.6 judgments for answer semantics
→ one complete scored run
→ canonical Git baseline or complete baseline comparison
```

The benchmark treats Recall as a black box. It prepares valid synthetic vaults, invokes the monorepo's public `agentic-memory recall` command, and evaluates only the public response. It must not import Recall retrieval, ranking, evidence, synthesis, index, or provider internals.

The primary workflow is live and model-backed. A complete real run can replace one canonical committed baseline through `--update`; a later complete run shows every baseline answer, new answer, judgment, score, and delta. Normal repository validation tests the same benchmark machinery with deterministic fake Recall and judge adapters and performs no live model calls.

Batch 2 produces single-run directional evidence. It does not establish statistical significance, release thresholds, or model stability.

## Goal

Enable a maintainer to change the Recall CLI, rerun one canonical benchmark suite, and answer:

- What did Recall answer before?
- What does Recall answer now?
- How was each answer judged against the same authoritative reference answer?
- Did each case improve, regress, or remain unchanged?
- Did the equal-weight suite score move up or down?
- Did any deterministic public-contract or forbidden-fact gate fail?

The benchmark is the primary iteration loop for judging whether Recall changes produce directionally better answers.

## What Batch 2 Proves

When Batch 2 is complete, the system proves that:

1. Two committed synthetic fixture definitions can be initialized, indexed, and recalled through public Agentic Memory commands.
2. The complete canonical corpus can run against the real monorepo Recall CLI without importing Recall internals.
3. Every supported-answer case can be judged independently against an authoritative reference answer by a judge different from Recall's local Qwen synthesis model.
4. Deterministic abstention, status, forbidden-fact, execution, and public-response rules are evaluated without model discretion.
5. One complete real run can be stored atomically as a canonical Git baseline.
6. A later compatible complete run can reuse stored baseline judgments, judge only the new answers, and report per-case and aggregate score deltas.
7. Normal CI can verify fixture loading, orchestration, scoring, baseline updates, comparisons, reports, and failures without live embedding, synthesis, or judgment models.

Batch 2 does not prove that Recall is statistically stable, release-ready, correct at scale, within a latency target, or robust across repeated model trials.

## User Workflow

### Create or replace the canonical baseline

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench -- --update
```

The command:

1. loads the complete canonical suite;
2. prepares and indexes every synthetic fixture once;
3. runs every question through the real public Recall CLI;
4. deterministically scores status-only and forbidden-fact outcomes;
5. sends eligible answered responses to the configured GPT-5.6 judge;
6. calculates the complete suite score;
7. atomically replaces the canonical baseline under `packages/agentic-memory-retrieval-bench/baselines/`;
8. prints the resulting baseline report.

The explicit `--update` flag authorizes replacement after any complete, operationally valid run, including a run with a lower score or deterministic hard-gate failures. Git diff review is the approval mechanism. An incomplete or operationally invalid run must never partially change the baseline.

### Compare a new run

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench
```

The command performs the same complete fixture and Recall workflow, reuses the stored baseline answers and judgments exactly, judges only the new eligible answers, and reports the full comparison.

A missing, stale-corpus, incompatible-judge, or undecodable baseline produces actionable guidance to run with `--update`. A normal run never creates or mutates a baseline.

### Machine-readable output

```sh
bun --filter='./packages/agentic-memory-retrieval-bench' run bench -- --json
bun --filter='./packages/agentic-memory-retrieval-bench' run bench -- --update --json
```

JSON stdout must remain one schema-validated document. Diagnostics belong on stderr. Human and JSON reports must contain the same substantive evidence.

## Scope

### In scope

- One canonical all-or-nothing benchmark suite.
- Two source-only synthetic fixture-vault manifests.
- Fresh disposable vault initialization and indexing through public Agentic Memory commands.
- Exactly one fixture assignment per case.
- Migration of the existing 16 questions without question expansion.
- Authoritative `answered` reference answers and explicit `not_found` expectations.
- A Recall-subject domain seam with real public-CLI and deterministic fake adapters.
- A judgment domain seam with a Pi subscription adapter and deterministic fake adapter.
- `openai-codex/gpt-5.6-sol` with `high` reasoning as the pinned live judge.
- Independent three-level judgments with concise rationales.
- Deterministic status and forbidden-fact scoring.
- Equal-weight aggregate scoring and percentage-point deltas.
- One canonical Git baseline updated only through `--update`.
- Corpus and judge compatibility fingerprints.
- Complete human and JSON comparison reports.
- Existing advisory Recall wall-clock p50 and p95 measurements.
- Fail-fast operational failure behavior.
- Deterministic, model-free normal tests.
- One opt-in end-to-end live proof that creates the initial committed baseline.
- A documented failure-to-regression workflow.

### Explicitly out of scope

- Partial, filtered, tagged, fixture-specific, or case-specific runs.
- Partial baseline creation or update.
- Multiple, selectable, or named baseline sets.
- Arbitrary external vaults or a `--vault` benchmark option.
- Adding questions beyond migration of the current 16.
- Repeated Recall or judge trials.
- Statistical significance, confidence intervals, or flakiness metrics.
- Release thresholds or score-regression failure gates.
- Multidimensional, pairwise, ensemble, or calibrated judging.
- Alternate judge models or automatic judge fallback.
- Automatic retries for Recall or judgment failures.
- Token or monetary cost reporting.
- Large, noisy, adversarial, malformed-provider, or scale corpora.
- Dedicated source-leakage, conflict, duplicate-claim, or category aggregates.
- Candidate-, chunk-, evidence-, ranking-, or provider-level diagnostics.
- Cold-versus-warm decomposition or performance targets.
- Baseline migration across artifact formats.
- An explicit baseline artifact schema-version field.
- Recall behavior, ranking, retrieval, synthesis, indexing, or public-contract changes.

## Roadmap Boundary

This approved direction intentionally changes the earlier roadmap split:

- Batch 2 now includes one minimal independent model judge because judged score deltas are the benchmark's primary product outcome.
- Batch 2 uses one canonical baseline rather than multiple named baselines.
- Tags, filtering, and partial runs are deferred.
- Batch 12 still owns repeated trials, judge calibration and richer evaluation, statistical confidence, alternate judges, expanded corpora, release thresholds, tokens and cost, and candidate diagnostics.

The roadmap must be reconciled with these boundaries before Batch 2 implementation Tickets are created.

## Existing Implementation Inventory

The existing package is:

```text
packages/agentic-memory-retrieval-bench/
```

It currently provides:

- one `fixtures/basic-vault/` synthetic overlay;
- one `fixtures/queries.json` file containing 16 cases;
- case fields for `id`, `question`, expected status, required substrings, and forbidden substrings;
- a disposable-vault workflow that runs `agentic-memory init`, copies the fixture, and runs `agentic-memory index`;
- a subprocess runner hard-coded to `agentic-memory recall`;
- public Recall JSON decoding through the core public contract;
- deterministic gates for process exit, stdout decoding, expected status, required substrings, and forbidden substrings;
- sequential case execution;
- per-case wall-clock duration and aggregate p50/p95;
- human and JSON reports;
- nonzero exit when existing hard gates fail;
- deterministic tests using a fake child-process spawner;
- one model-free real-process boundary test using a missing vault;
- an opt-in live benchmark command.

### Exact remaining delta

Batch 2 must:

1. Replace hard-coded Recall orchestration with a domain-shaped Recall-subject seam while preserving the public CLI adapter.
2. Introduce a canonical suite manifest and two fixture manifests.
3. Assign every migrated case to exactly one fixture.
4. Replace required-substring quality scoring with authoritative reference answers and independent semantic judgments.
5. Preserve explicit forbidden facts as deterministic hard gates.
6. Add a judgment service with fake and isolated Pi subscription adapters.
7. Add complete three-level case scoring and aggregate score calculation.
8. Add corpus and judge fingerprints.
9. Add one atomic canonical baseline update workflow under `baselines/`.
10. Make the default command compare a complete new run with the stored baseline.
11. Replace the current report with complete baseline-versus-new evidence and deltas.
12. Remove `--vault` and reject all partial/filtering modes.
13. Document and test fail-fast invalid-run behavior and the failure-to-regression workflow.
14. Reclassify subprocess exit and decode failures from scored case gates to typed operational failures.
15. Validate public response question equality and add bounded subprocess timeout, termination, and cleanup behavior.
16. Generate and commit the first complete real baseline.
17. Reconcile the roadmap with the approved Batch 2 and Batch 12 boundary before implementation Tickets are created.

The package must not expand Recall behavior or inspect private Recall implementation state while making this change.

## Domain Model

### Canonical suite

The only benchmark suite in Batch 2. It owns the complete fixture and case set. It is valid only as a whole and has one canonical baseline.

### Fixture manifest

A stable fixture identity and source-only overlay path. The runner applies the overlay to a freshly initialized disposable vault and then indexes that vault through the public CLI. Generated semantic indexes are never committed.

### Benchmark case

One stable case identity, one fixture identity, one singular question, and one expected outcome. A case is never run outside the complete suite in Batch 2.

### Reference answer

The complete authoritative evaluation truth for an `answered` case at the question's intended granularity. It is the truth against which both baseline and new Recall answers are judged. A material factual claim absent from the reference answer is unsupported for benchmark scoring. The reference answer is not an expected literal output string.

### Recall subject

A service that runs one case against a prepared vault and returns either a decoded public Recall response or a typed execution failure. Live runs use the monorepo public CLI; normal tests use a deterministic fake.

### Judge

A service that independently evaluates one public `answered` response against its question and reference answer. It does not see fixture files, baseline answers, competing answers, or previous judgments.

### Judgment

One of `correct`, `partially_correct`, or `incorrect`, plus a concise rationale. Numeric score is derived by benchmark policy rather than independently supplied by the model.

### Canonical baseline

The complete committed snapshot of one operationally valid live suite run: inputs, Recall responses, evaluations, scores, metrics, compatibility fingerprints, and provenance. It is generated, disposable, and replaceable through `--update`; Git is its history.

### Comparison run

A complete operationally valid live suite run evaluated against a compatible canonical baseline. Baseline judgments are reused; only new eligible answers are sent to the judge.

## Logical Schemas

The exact TypeScript declarations must use Effect Schema and make invalid states unrepresentable. The following JSON shapes define the approved public benchmark artifacts conceptually.

### Canonical suite manifest

```json
{
  "id": "recall-canonical",
  "fixtures": [
    {
      "id": "project-memory",
      "manifest": "fixtures/manifests/project-memory.json"
    },
    {
      "id": "user-preferences",
      "manifest": "fixtures/manifests/user-preferences.json"
    }
  ],
  "cases": "fixtures/cases.json"
}
```

Requirements:

- The suite ID is fixed and unique.
- Both fixture IDs are unique and referenced by at least one case.
- Manifest and case paths resolve only within the benchmark package.
- The complete ordered case list is loaded before fixture preparation or model work.
- The suite manifest provides no filtering, tags, weights, or optional members.

### Fixture manifest

```json
{
  "id": "project-memory",
  "overlay": "fixtures/vaults/project-memory"
}
```

Requirements:

- `id` is stable and unique within the suite.
- `overlay` resolves only within the benchmark package.
- The overlay contains managed synthetic Markdown, not a generated semantic index.
- Traversal and absolute overlay paths are rejected.

### Case expectation

Answered:

```json
{
  "status": "answered",
  "referenceAnswer": "Alpha retry scheduling uses a 200ms p95 latency budget.",
  "forbiddenFacts": ["120ms p95", "350ms p95", "400ms p95"]
}
```

Not found:

```json
{
  "status": "not_found",
  "forbiddenFacts": ["200ms p95", "5 second batch retry window"]
}
```

Rules:

- `answered` requires one nonempty reference answer.
- `not_found` cannot contain a reference answer.
- `forbiddenFacts` is explicit case truth and may be empty.
- Required-substring arrays are removed.

### Benchmark case

```json
{
  "id": "alpha-current-latency",
  "fixtureId": "project-memory",
  "question": "For Alpha Product, what current p95 latency budget applies to the retry scheduler?",
  "expected": {
    "status": "answered",
    "referenceAnswer": "Alpha retry scheduling uses a 200ms p95 latency budget.",
    "forbiddenFacts": ["120ms p95", "350ms p95", "400ms p95"]
  }
}
```

### Public Recall observation

A successful subject observation contains:

```json
{
  "response": {
    "status": "answered",
    "question": "For Alpha Product, what current p95 latency budget applies to the retry scheduler?",
    "answer": "Use a 200ms p95 latency budget.",
    "warnings": []
  },
  "durationMs": 152
}
```

Process command, stderr, and typed execution diagnostics may exist in internal reports, but public Recall response decoding must continue to depend only on the core package's public Recall contract.

### Judge request

```json
{
  "question": "For Alpha Product, what current p95 latency budget applies to the retry scheduler?",
  "referenceAnswer": "Alpha retry scheduling uses a 200ms p95 latency budget.",
  "recallResponse": {
    "status": "answered",
    "question": "For Alpha Product, what current p95 latency budget applies to the retry scheduler?",
    "answer": "Use a 200ms p95 latency budget.",
    "warnings": []
  }
}
```

The judge request never includes:

- baseline or competing answers;
- previous judgments or scores;
- fixture Markdown;
- Recall evidence, paths, scores, prompts, providers, or diagnostics;
- Git diffs or implementation details.

### Judge output

```json
{
  "outcome": "correct",
  "rationale": "The response states the same latency constraint as the reference answer."
}
```

The only outcomes are:

- `correct` → `1.0`;
- `partially_correct` → `0.5`;
- `incorrect` → `0.0`.

The model does not supply a free numeric score. The benchmark owns the exact outcome-to-score mapping.

### Case evaluation

```json
{
  "source": "judge",
  "outcome": "correct",
  "score": 1,
  "rationale": "The response states the same latency constraint as the reference answer.",
  "hardGateViolations": []
}
```

`source` is either `deterministic` or `judge`. Deterministic evaluations carry benchmark-owned rationale. Judge evaluations carry the decoded judge rationale.

### Canonical baseline

The logical baseline contains:

```json
{
  "corpusFingerprint": "sha256:...",
  "judgeFingerprint": "sha256:...",
  "createdAt": "2026-08-10T00:00:00.000Z",
  "recallRevision": {
    "commit": "abcdef123456...",
    "dirty": false
  },
  "judge": {
    "provider": "openai-codex",
    "model": "gpt-5.6-sol",
    "thinking": "high",
    "piVersion": "...",
    "promptFingerprint": "sha256:..."
  },
  "score": 87.5,
  "metrics": {
    "correctCount": 13,
    "partiallyCorrectCount": 2,
    "incorrectCount": 1,
    "statusAccuracy": 93.75,
    "forbiddenFactViolationCount": 0,
    "recallLatencyP50Ms": 152,
    "recallLatencyP95Ms": 430
  },
  "cases": []
}
```

Every baseline case stores its case input, public Recall response, Recall duration, evaluation source, judgment outcome, derived score, rationale, and hard-gate violations. The physical one-file-versus-multiple-file layout is an implementation detail, but the logical artifact and atomic update behavior are fixed.

The baseline deliberately has no artifact schema-version field. The implementation supports only its current strict schema. An undecodable artifact is incompatible and must be regenerated with `--update`.

### Comparison report

A comparison report contains:

- corpus and judge compatibility evidence;
- baseline and new Recall revisions;
- baseline score, new score, and percentage-point delta;
- baseline and new aggregate metrics;
- every case's question and expected outcome;
- every answered case's reference answer;
- baseline answer, evaluation, score, and rationale;
- new answer, evaluation, score, and rationale;
- per-case score delta;
- deterministic hard-gate violations;
- advisory Recall duration values.

No cases may be omitted merely because they are unchanged.

## Fixture Design

### `project-memory`

Contains the existing Alpha/Beta scenarios needed for:

- project-specific facts;
- competing-project distractors;
- current, stale, archived, and source-only facts;
- rationale and resumption context;
- route and map framing;
- contextual user preference;
- unknown and off-topic abstention;
- repeated-fact consistency.

### `user-preferences`

A minimal focused vault for the general user-option-format question. It contains only the synthetic user memory required to answer that question and unrelated material needed to keep the scenario realistic.

### Fixture lifecycle

For each complete run:

1. create a scoped temporary directory;
2. invoke `agentic-memory init <temp-vault> --yes --json`;
3. overlay the manifest's source-only synthetic content;
4. invoke `agentic-memory index --vault <temp-vault> --json`;
5. retain the prepared vault for every case assigned to that fixture;
6. remove the entire temporary vault at scoped cleanup.

The runner prepares each fixture once. A fixture preparation failure invalidates the run immediately.

## Corpus Migration

The initial Batch 2 migration preserves all 16 existing case IDs and questions. Batch 2 implementation changes only their fixture assignment and expectation representation. After the foundation ships, the documented failure-to-regression workflow may add regression cases; every later run still executes the complete manifest, and all counts are derived rather than hard-coded.

Migration rules:

1. Assign the general `user-option-format-only` case to `user-preferences`.
2. Assign the remaining existing cases to `project-memory`.
3. Convert each `answered` case's existing required facts and fixture truth into one concise authoritative reference answer.
4. Preserve existing forbidden facts when they identify concrete contradictions, competing facts, or prohibited leakage.
5. Convert existing abstention cases to the explicit `not_found` expectation variant.
6. During the initial Batch 2 migration, do not add tags, weights, new questions, or new behavioral categories.
7. Review every reference answer against the synthetic fixture Markdown before generating the first baseline.

## Recall-Subject Seam

The benchmark domain depends on one small operation conceptually equivalent to:

```text
run(question, preparedFixtureVault)
→ public Recall observation
→ or typed subject failure
```

### Public CLI adapter

The live adapter invokes:

```sh
agentic-memory recall "<question>" --vault <prepared-fixture> --json
```

It owns subprocess execution and stdout/stderr capture. It decodes stdout through the core package's public Recall response decoder. It does not import private Recall modules.

### Fake adapter

Normal tests provide controlled public responses and typed failures without starting a process or loading models. Process-adapter tests may continue using a fake process spawner where the subprocess contract itself is under test.

Recall subject failures are operational failures, not Incorrect answers.

## Judgment Service

The benchmark domain depends on one operation conceptually equivalent to:

```text
judge(question, referenceAnswer, publicRecallResponse)
→ correct | partially_correct | incorrect
+ concise rationale
→ or typed judgment failure
```

### Semantic rubric

For eligible `answered` cases, the judge applies exactly:

- **Correct:** Captures the reference answer's essential meaning without a material contradiction or a material factual addition not supported by the reference answer.
- **Partially correct:** Captures some essential meaning but omits or weakens a material part.
- **Incorrect:** Misses or contradicts the essential answer, answers a different question, or introduces a material factual claim not supported by the reference answer.

The reference answer is exhaustive for benchmark scoring at the question's intended granularity. The judge does not infer truth from fixture files or outside knowledge.

### Deterministic precedence

The benchmark checks every decoded public `answer` for explicitly forbidden facts, regardless of expected or actual status. It then:

1. collects every forbidden-fact hard-gate violation;
2. collects a status hard-gate violation when expected and actual statuses differ;
3. assigns Incorrect when either deterministic violation set is nonempty;
4. otherwise assigns Correct when expected and actual statuses are both `not_found`;
5. otherwise calls the live judge for the matching `answered` response.

When status and forbidden-fact checks both fail, the report records both hard-gate violations even though the case has only one Incorrect outcome.

Forbidden-fact matching preserves the existing deterministic rule:

1. lowercase the public `answer` and configured forbidden fact;
2. replace every run of Unicode whitespace with one ASCII space;
3. trim leading and trailing whitespace;
4. report a violation when the normalized public answer contains the normalized nonempty forbidden fact as a substring.

Matching inspects only the public `answer` field. It never searches the question, warnings, stderr, judge rationale, fixture content, or baseline metadata.

### Pi subscription adapter

The initial live adapter invokes an isolated one-shot Pi subprocess using the user's existing ChatGPT subscription:

```text
provider: openai-codex
model: gpt-5.6-sol
thinking: high
session persistence: disabled
tools: disabled
context files: disabled
skills: disabled
extensions: disabled
prompt templates: disabled
```

The adapter must:

- use a fixed benchmark-owned system prompt and rubric;
- send only the bounded judge request;
- request one JSON judgment object;
- decode the returned content strictly through Effect Schema;
- expose precise process, authentication, provider, model, and decoding failures;
- perform no automatic retry;
- record the Pi version as provenance;
- never persist or report subscription credentials or bearer tokens.

The benchmark must invoke the `openai-codex` subscription provider rather than the separately billed `openai` API-key provider.

### Fake judge

Normal tests provide deterministic judgments and failures through the judgment service. They do not invoke Pi or a live provider.

### Process timeouts and cleanup

The live adapters use fixed Batch 2 limits:

- each `agentic-memory init` or `agentic-memory index` preparation command: 15 minutes;
- each `agentic-memory recall` command: 120 seconds;
- each Pi judgment command: 5 minutes;
- Git and Pi provenance commands: 30 seconds.

The benchmark performs no benchmark-level retry. On timeout it must terminate the child process, await process settlement, close owned streams and handles, clean scoped temporary vaults, preserve the prior baseline byte-for-byte, and return the typed failure for the timed-out stage.

## Compatibility and Provenance

### Corpus fingerprint

The benchmark computes one deterministic SHA-256 fingerprint over a canonical representation of:

- the canonical suite manifest;
- both fixture manifests;
- sorted vault-relative fixture paths and source bytes;
- all case IDs, fixture assignments, questions, expected statuses, reference answers, and forbidden facts.

Generated indexes, temporary paths, timestamps, Git state, model output, and baseline files are excluded.

A normal comparison requires the current corpus fingerprint to equal the baseline fingerprint. A mismatch fails before live fixture preparation or model calls and instructs the user to review the corpus change and run `--update`.

### Judge fingerprint

The benchmark computes one deterministic SHA-256 fingerprint over:

- provider `openai-codex`;
- model `gpt-5.6-sol`;
- thinking level `high`;
- exact judge system prompt;
- exact three-level rubric and deterministic outcome-to-score mapping;
- judge request and output contracts relevant to interpretation.

A normal comparison requires the current judge fingerprint to equal the baseline fingerprint. A mismatch fails before live model calls and instructs the user to run `--update`.

The recorded Pi version is provenance, not a compatibility gate in Batch 2.

### Recall revision

Every baseline and comparison report records:

- the current Git commit;
- whether the working tree is dirty.

Recall revisions are not compatibility gates. Comparing different Recall revisions is the purpose of the tool.

## Scoring and Metrics

### Case score

- Correct = `1.0`
- Partially correct = `0.5`
- Incorrect = `0.0`

Every completed case has exactly one outcome and one derived score.

### Suite score

```text
sum(case scores) / case count × 100
```

All 16 cases have equal weight. No categories, tags, thresholds, or manual weights affect the score.

### Delta

```text
new suite score − baseline suite score
```

The report displays aggregate delta in percentage points and each case's numeric delta. It does not claim statistical significance.

### Additional lean metrics

- Correct count.
- Partially correct count.
- Incorrect count.
- Expected-status accuracy.
- Explicit forbidden-fact violation count.
- Advisory Recall wall-clock p50 and p95.

Required-fact coverage is replaced by semantic judgment. Dedicated source, conflict, duplicate, category, token, cost, and trial metrics are deferred.

## Baseline Policy

- There is exactly one canonical baseline.
- Its root directory is `packages/agentic-memory-retrieval-bench/baselines/`.
- It is generated only by a complete operationally valid `--update` run.
- It is committed to Git and reviewed as a snapshot diff.
- A normal run is read-only with respect to the baseline.
- Baseline answers and judgments are never recomputed during comparison.
- A judge, rubric, or corpus change requires a full `--update`.
- A lower score does not prevent an explicitly requested update.
- Hard-gate violations do not prevent an operationally valid update, but remain visible and affect exit behavior.
- Physical storage as one file or multiple files is an implementation detail.
- There is no migration framework or artifact schema-version field.
- An incompatible artifact is deleted or replaced through `--update`.

Atomic replacement must ensure that a failed run leaves the prior baseline byte-for-byte unchanged.

## Failure Semantics

### Invalid run

Any of the following invalidates the run immediately:

- suite, fixture, or case schema decoding failure;
- missing, undecodable, or incompatible baseline during a normal comparison;
- corpus or judge fingerprint mismatch during a normal comparison;
- fixture path escape or invalid fixture definition;
- fixture initialization or indexing failure;
- Recall subprocess failure or timeout;
- malformed or undecodable public Recall output;
- public response question mismatch;
- Pi unavailable or unauthenticated;
- configured judge model unavailable;
- judge process failure or timeout;
- malformed or undecodable judge output;
- empty or invalid judge rationale;
- filesystem or atomic-write failure.

Invalid runs:

- fail fast;
- produce no quality score or delta;
- make no baseline change;
- exit nonzero with typed, actionable guidance.

Operational failures are never converted to Incorrect scores.

`--update` is the recovery path for a missing, undecodable, or incompatible baseline. It does not decode or require compatibility with the old artifact before live work. It leaves any old baseline bytes untouched during the run and replaces them only after the new complete run is operationally valid.

### Complete run with quality failures

A complete run may contain:

- expected-status mismatches;
- explicit forbidden facts;
- Partially correct judgments;
- Incorrect judgments;
- a lower aggregate score than the baseline.

The run remains valid and produces the complete report. Expected-status and forbidden-fact hard-gate violations cause a nonzero exit. Purely judge-scored regressions and lower aggregate scores remain advisory and do not change the exit status.

An explicit `--update` still writes a complete valid baseline when hard-gate violations exist, then reports those violations visibly.

### Invalid arguments

Unknown arguments, `--vault`, filters, tags, case selectors, fixture selectors, or a missing value for a supported argument fail before fixture or model work and print usage guidance.

## Reports

### Human comparison report

The default report shows:

- baseline and new Recall revision provenance;
- corpus and judge identities;
- aggregate baseline score, new score, and percentage-point delta;
- baseline and new lean metrics;
- every case, in canonical order;
- question and expected outcome;
- reference answer for answered cases;
- baseline public answer, judgment outcome, score, and rationale;
- new public answer, judgment outcome, score, and rationale;
- per-case score delta;
- hard-gate violations;
- advisory Recall durations.

No unchanged case is hidden.

### JSON result

With `--json`, stdout always contains exactly one schema-validated discriminated result:

- `completed_update` — the complete newly stored baseline report;
- `completed_comparison` — the complete baseline-versus-new report;
- `invalid_run` — typed stage, error tag, safe message, and actionable guidance, with no score or delta;
- `invalid_arguments` — safe message and usage guidance, with no score or delta.

Completed JSON results contain the same substantive information as human reports. Invalid JSON results make failure machine-readable without pretending that a quality report exists. Additional process diagnostics may be written to stderr, but stdout remains one JSON document.

Without `--json`, invalid runs and arguments print human guidance to stderr and no quality report to stdout.

### Update report

An update report shows the complete newly stored baseline, its aggregate score and metrics, every case answer and evaluation, destination under `baselines/`, and whether deterministic hard gates failed.

## CLI Behavior

Supported benchmark arguments in Batch 2:

```text
--update  Create or atomically replace the canonical baseline
--json    Emit the schema-validated JSON report
--help    Print usage
```

No case-selection, fixture-selection, tag, filter, vault, judge-selection, baseline-selection, retry, threshold, or trial-count flags are supported.

### Exit behavior

- `0`: complete valid run with no deterministic hard-gate violations, regardless of judge-score delta.
- `1`: operationally invalid run or complete run with deterministic status/forbidden-fact violations.
- `2`: invalid CLI arguments.

The implementation may preserve more precise typed internal failures, but the human guidance and JSON failure boundary must remain stable and actionable.

## Failure-to-Regression Workflow

When a real Recall failure is discovered:

1. Reduce it to the smallest non-private synthetic memory needed to reproduce it.
2. Add or revise content in one of the two canonical fixture overlays; do not add a third fixture in Batch 2.
3. Add or revise one canonical case with an authoritative reference answer or `not_found` expectation.
4. Review the resulting corpus-fingerprint change.
5. Run the full suite with `--update` to capture the current failing behavior and judgment as the new canonical starting point.
6. Commit the corpus and baseline change together.
7. Change Recall in its owning package without changing the benchmark expectation.
8. Run the complete comparison suite.
9. Review every per-case and aggregate delta.
10. When the new behavior is accepted, run the full suite with `--update` and review the Git baseline diff.

This workflow permits an intentionally committed baseline to contain Incorrect cases. The baseline records observed behavior; reference answers remain the authoritative desired behavior.

## Testing Strategy

Normal automated tests must not load an embedding model, contact local Qwen, invoke the OpenAI subscription, or require network access.

### Contract and domain tests

- fixture, case, expectation, judgment, baseline, and report schema decoding;
- rejection of contradictory expectation variants;
- stable corpus and judge fingerprints;
- fingerprint sensitivity to every owned input;
- outcome-to-score mapping;
- deterministic status precedence;
- forbidden-fact normalization and precedence;
- equal-weight aggregate score and deltas;
- percentile behavior;
- complete case ordering.

### Service tests

- fake Recall subject success and every typed failure;
- fake judge success and every typed failure;
- judge input isolation;
- baseline judgments are not recomputed during comparison;
- every eligible new answer is judged exactly once;
- deterministic cases do not call the judge;
- fixture preparation occurs once per fixture;
- all 16 cases run in the complete suite.

### Baseline tests

- missing baseline guidance;
- strict incompatible-baseline rejection;
- corpus and judge mismatch rejection before live work;
- complete atomic create and replacement;
- prior baseline preservation after every invalid-run failure point;
- lower-score update acceptance;
- hard-gate update behavior;
- normal comparison never mutates baseline.

### CLI and report tests

- human and JSON update reports;
- human and JSON complete comparison reports;
- stdout/stderr separation;
- exit codes for success, hard gates, operational failures, and invalid arguments;
- rejection of `--vault`, filters, tags, and selectors;
- no hidden unchanged cases;
- Git and Pi provenance without credentials.

### Process-adapter tests

- public Recall command construction and decoding through fake process boundaries;
- isolated Pi command construction;
- no sessions, tools, context files, skills, extensions, or prompt templates in judge invocation;
- subscription provider, exact model, and high reasoning selection;
- malformed process output and authentication/provider failure mapping.

### Live proof

One explicit opt-in proof must:

1. prepare and index both real disposable fixtures;
2. run all 16 cases through the real public Recall CLI;
3. judge all eligible answered cases through `openai-codex/gpt-5.6-sol` at high reasoning;
4. complete without an operational failure;
5. create the initial canonical baseline through `--update`;
6. commit that baseline for review.

The live proof is required for Batch 2 completion but is not part of `bun run check`.

## Tracer-Bullet Implementation Slices

Implementation Tickets must be created only after this PRD is approved. Use these small vertical slices in order.

### Slice 2.1 — Manifest-driven complete suite

Deliver one complete runnable suite using:

- a canonical suite manifest;
- `project-memory` and `user-preferences` fixture manifests;
- exact case-to-fixture assignment;
- freshly initialized and indexed disposable vaults;
- a Recall-subject seam with public CLI and fake adapters;
- all 16 migrated questions;
- no filters or external vault override.

Preserve temporary existing evaluation behavior only as needed to keep the slice runnable. Prove each fixture is prepared once and the entire suite remains model-free under fake adapters.

### Slice 2.2 — Independent scored judgments

Add:

- discriminated reference-answer expectations;
- deterministic status and forbidden-fact precedence;
- judgment service and output schema;
- fake judge tests;
- isolated Pi subscription adapter;
- Correct, Partially correct, and Incorrect scoring;
- equal-weight suite score and lean metrics.

Deliver a complete scored run report without baseline persistence.

### Slice 2.3 — Atomic canonical baseline update

Add:

- corpus and judge fingerprints;
- Git, judge, and Pi provenance;
- strict logical baseline schema;
- `baselines/` ownership;
- complete `--update` creation and replacement;
- atomic preservation on failure;
- human and JSON update reports.

Deliver a complete valid live run that can produce a reviewable baseline artifact.

### Slice 2.4 — Complete baseline comparison

Make the default command:

- require a compatible baseline;
- reuse stored baseline answers and judgments;
- judge only new eligible answers;
- show every baseline and new answer, judgment, score, and delta;
- calculate aggregate percentage-point delta;
- preserve advisory latency and hard-gate exit behavior;
- emit equivalent human and JSON reports.

### Slice 2.5 — Regression workflow and live acceptance

Finish:

- failure-to-regression documentation;
- actionable operational and compatibility failures;
- removal of obsolete `--vault` and required-substring behavior;
- full deterministic repository validation;
- first complete live `--update` run;
- committed canonical baseline.

## Completion Criteria

Batch 2 is complete when:

- this PRD is human-approved;
- implementation Tickets trace directly to the five tracer slices;
- two source-only synthetic fixture manifests prepare successfully through public init and index commands;
- all 16 migrated questions run as one indivisible suite;
- each case selects exactly one fixture;
- answered cases have reviewed authoritative reference answers;
- the real subject invokes only the public Recall CLI;
- the live judge uses the isolated Pi `openai-codex/gpt-5.6-sol:high` configuration;
- deterministic status and forbidden-fact outcomes bypass model judgment correctly;
- eligible answers receive schema-validated three-level judgments and derived scores;
- the suite produces the approved equal-weight aggregate score and lean metrics;
- `--update` atomically writes the one canonical Git baseline;
- normal runs produce complete baseline-versus-new reports and directional deltas;
- corpus and judge incompatibility is rejected before live work;
- operational failures fail fast without changing the baseline or producing a quality score;
- score regressions remain advisory while deterministic status/forbidden gates retain nonzero exits;
- normal CI is fully model-free;
- `bun run check` passes;
- the complete live proof succeeds;
- the initial canonical baseline is committed;
- the roadmap reflects the approved Batch 2 and Batch 12 boundary;
- no production Recall behavior or private Recall seam was added for benchmark convenience.

## Approval Gate

Human approval of this PRD is required before implementation Tickets are created. Approval confirms:

- the real-Recall and independent-judge workflow;
- the one canonical baseline and `--update` lifecycle;
- the three-level rubric and directional-delta interpretation;
- the all-or-nothing two-fixture, 16-case corpus;
- the explicit deferrals and roadmap boundary.
