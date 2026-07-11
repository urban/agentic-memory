import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";

import {
  makeQmdRecallStoreOptions,
  normalizeQmdCandidateResults,
  readDocumentsForQmdCandidates,
  type QmdLikeCandidateResult,
} from "../src/recall/QmdCandidateRetrieval.ts";
import {
  RecallCandidateRetrieval,
  type RecallCandidateRetrievalRequest,
  type RecallCandidateRetrievalService,
} from "../src/recall/RecallCandidateRetrieval.ts";
import { recallWithCandidateRetrieval } from "../src/recall/RecallWorkflow.ts";

const fixtureVaultPath = fileURLToPath(
  new URL("./fixtures/retrieval/basic-vault/", import.meta.url),
);
const CoreRecallRuntime = ManagedRuntime.make(BunServices.layer);

const withCoreRecallRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | BunServices.BunServices>) =>
  CoreRecallRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

const fakeResults = (paths: ReadonlyArray<string>): ReadonlyArray<QmdLikeCandidateResult> =>
  paths.map((path, index) => ({
    displayPath: `memory/${path}`,
    collectionName: "memory",
    docid: `private-${index}`,
    score: 1000 - index,
    filepath: `qmd://memory/${path}`,
    body: `provider snippet ${index}`,
  }));

const fakeRetrieval = (
  results: ReadonlyArray<QmdLikeCandidateResult>,
): RecallCandidateRetrievalService =>
  RecallCandidateRetrieval.of({
    retrieve: (request: RecallCandidateRetrievalRequest) =>
      readDocumentsForQmdCandidates({ ...request, results }),
  });

describe("QMD-compatible recall candidate retrieval", () => {
  afterAll(() => CoreRecallRuntime.dispose());

  it("normalizes fake results into policy-safe internal references", () => {
    const results = [
      {
        displayPath: "memory/projects/alpha-product.md",
        collectionName: "memory",
        docid: "qmd-project-id",
        score: 0.99,
        filepath: "qmd://memory/projects/alpha-product.md",
        body: "untrusted provider snippet",
      },
      {
        displayPath: "memory/sources/alpha-source.md",
        collectionName: "memory",
        docid: "qmd-source-id",
        score: 1,
      },
      {
        displayPath: "memory/.agentic-memory/control.md",
        collectionName: "memory",
        score: 1,
      },
      {
        displayPath: "memory/AGENTS.md",
        collectionName: "memory",
        score: 1,
      },
      {
        displayPath: "memory/projects/../AGENTS.md",
        collectionName: "memory",
        score: 1,
      },
    ] satisfies ReadonlyArray<QmdLikeCandidateResult>;

    const defaultCandidates = normalizeQmdCandidateResults(results, false);
    assert.deepStrictEqual(defaultCandidates, [
      { path: "projects/alpha-product.md", memoryLayer: "project" },
    ]);
    assert.deepStrictEqual(Object.keys(defaultCandidates[0] ?? {}).toSorted(), [
      "memoryLayer",
      "path",
    ]);

    const sourceCandidates = normalizeQmdCandidateResults(results, true);
    assert.deepStrictEqual(sourceCandidates, [
      { path: "projects/alpha-product.md", memoryLayer: "project" },
      { path: "sources/alpha-source.md", memoryLayer: "source" },
    ]);
  });

  it("builds isolated QMD store options with an explicit cache database and inline config", () => {
    const withoutSources = makeQmdRecallStoreOptions({
      vaultPath: "/vaults/personal-memory",
      cacheRoot: "/tmp/xdg-cache",
      includeSources: false,
    });
    const withSources = makeQmdRecallStoreOptions({
      vaultPath: "/vaults/personal-memory",
      cacheRoot: "/tmp/xdg-cache",
      includeSources: true,
    });

    assert.match(
      withoutSources.dbPath,
      /^\/tmp\/xdg-cache\/agentic-memory\/qmd\/[a-f0-9]{8}\/index\.sqlite$/u,
    );
    assert.notInclude(withoutSources.dbPath, "/vaults/personal-memory");
    assert.strictEqual(withoutSources.config.collections.memory.path, "/vaults/personal-memory");
    assert.include(withoutSources.config.collections.memory.ignore, ".agentic-memory/**");
    assert.include(withoutSources.config.collections.memory.ignore, ".agentic-memory-link/**");
    assert.include(withoutSources.config.collections.memory.ignore, ".git/**");
    assert.include(withoutSources.config.collections.memory.ignore, ".obsidian/**");
    assert.include(withoutSources.config.collections.memory.ignore, "AGENTS.md");
    assert.include(withoutSources.config.collections.memory.ignore, ".cache/**");
    assert.include(withoutSources.config.collections.memory.ignore, "sources/**");
    assert.notInclude(withSources.config.collections.memory.ignore, "sources/**");
  });

  it.effect("keeps route-aware ranking and answer assembly after fake QMD retrieval", () =>
    withCoreRecallRuntime(
      recallWithCandidateRetrieval({
        vaultPath: fixtureVaultPath,
        question: "I am changing Alpha retry scheduler timing. What constraint matters?",
        includeSources: false,
      }).pipe(
        Effect.provideService(
          RecallCandidateRetrieval,
          fakeRetrieval(
            fakeResults([
              "notes/beta-retry-policy.md",
              "MEMORY.md",
              "maps/alpha-product.md",
              "projects/alpha-product.md",
              "notes/alpha-latency-budget.md",
              "records/2026-07-01-alpha-scheduler-decision.md",
            ]),
          ),
        ),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "200ms p95");
        assert.notInclude(response.answer, "5 second batch retry window");
        assert.notInclude(response.answer, "Read when");
        assert.deepStrictEqual(Object.keys(response).toSorted(), [
          "answer",
          "question",
          "status",
          "warnings",
        ]);
        for (const internalDetail of [
          "QMD",
          "qmd://",
          "private-",
          "provider snippet",
          "index.sqlite",
          "score",
        ]) {
          assert.notInclude(response.answer, internalDetail);
          assert.isFalse(response.warnings.some((warning) => warning.includes(internalDetail)));
        }
      }),
    ),
  );

  it.effect("preserves source inclusion semantics through fake QMD retrieval", () =>
    withCoreRecallRuntime(
      Effect.all([
        recallWithCandidateRetrieval({
          vaultPath: fixtureVaultPath,
          question:
            "What source verification evidence did the Alpha Product responsiveness trial record for the latency decision?",
          includeSources: false,
        }).pipe(
          Effect.provideService(
            RecallCandidateRetrieval,
            fakeRetrieval(
              fakeResults([
                "projects/alpha-product.md",
                "sources/2026-07-01-alpha-scheduler-source.md",
              ]),
            ),
          ),
        ),
        recallWithCandidateRetrieval({
          vaultPath: fixtureVaultPath,
          question:
            "What source verification evidence did the Alpha Product responsiveness trial record for the latency decision?",
          includeSources: true,
        }).pipe(
          Effect.provideService(
            RecallCandidateRetrieval,
            fakeRetrieval(
              fakeResults([
                "projects/alpha-product.md",
                "sources/2026-07-01-alpha-scheduler-source.md",
              ]),
            ),
          ),
        ),
      ]),
    ).pipe(
      Effect.map(([withoutSources, withSources]) => {
        assert.strictEqual(withoutSources.status, "not_found");
        assert.notInclude(withoutSources.answer, "180ms observed p95 verification threshold");
        assert.strictEqual(withSources.status, "answered");
        assert.include(withSources.answer, "180ms observed p95 verification threshold");
        assert.notInclude(withSources.answer, "sources/");
      }),
    ),
  );

  it.effect("applies active and archived policy after fake QMD candidates are returned", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix: "recall-qmd-status-" });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# USER\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "alpha-active.md"),
            `---
type: project
status: active
project_status: active
aliases:
  - Alpha Product
---
# Alpha Product
Alpha Product retry scheduling uses a **200ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "alpha-archive.md"),
            `---
type: project
status: archived
project_status: archived
aliases:
  - Alpha Product
---
# Archived Alpha Product
Alpha Product retry scheduling used a **900ms p95 latency budget**.
`,
          );

          return yield* recallWithCandidateRetrieval({
            vaultPath,
            question: "What latency budget should Alpha Product retry scheduling use?",
            includeSources: false,
          }).pipe(
            Effect.provideService(
              RecallCandidateRetrieval,
              fakeRetrieval(
                fakeResults(["projects/alpha-archive.md", "projects/alpha-active.md", "MEMORY.md"]),
              ),
            ),
          );
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "200ms p95");
        assert.notInclude(response.answer, "900ms p95");
      }),
    ),
  );
});
