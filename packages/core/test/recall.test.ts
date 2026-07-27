import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import {
  filesystemRecallCandidateRetrieval,
  RecallCandidateRetrieval,
} from "../src/recall/RecallCandidateRetrieval.ts";
import { normalizeForDeduplication } from "../src/recall/RecallText.ts";
import { recallWithCandidateRetrieval } from "../src/recall/RecallWorkflow.ts";

const fixtureVaultPath = fileURLToPath(
  new URL("./fixtures/retrieval/basic-vault/", import.meta.url),
);
const alphaQuestion =
  "In Alpha Product, I need to tune the retry scheduler. What latency budget decision should I follow, and how should I present options back to Urban?";
const alphaLatencyOnlyQuestion =
  "In Alpha Product, what latency budget should I follow for the retry scheduler?";
const betaRetryPolicyQuestion = "In Beta Platform, what retry policy should I follow?";
const userOptionFormatQuestion = "How should I present prioritization options?";
const unknownProjectQuestion = "What launch window did Gamma Project choose?";
const sourceVerificationQuestion =
  "What source verification evidence did the Alpha Product responsiveness trial record for the latency decision?";
const leakProbeQuestion = `${alphaQuestion} Should I reread MEMORY.md, USER.md, [[projects/alpha-product]], or .agentic-memory before answering?`;
const forbiddenGeneratedSubstrings = [
  "projects/",
  "notes/",
  "maps/",
  "people/",
  "records/",
  "sources/",
  "MEMORY.md",
  "USER.md",
  "[[",
  ".agentic-memory",
  "QMD",
  "LexicalProvider",
] satisfies ReadonlyArray<string>;

const CoreRecallRuntime = ManagedRuntime.make(BunServices.layer);

const recall = (request: import("../src/recall/RecallContract.ts").RecallRequest) =>
  recallWithCandidateRetrieval(request).pipe(
    Effect.provideService(RecallCandidateRetrieval, filesystemRecallCandidateRetrieval),
  );

const occurrenceCount = (text: string, fragment: string): number =>
  text.toLocaleLowerCase().split(fragment.toLocaleLowerCase()).length - 1;

const withCoreRecallRuntime = <A, E, R>(effect: Effect.Effect<A, E, R | BunServices.BunServices>) =>
  CoreRecallRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

const assertGeneratedFieldsDoNotLeak = (response: {
  readonly answer: string;
  readonly warnings: ReadonlyArray<string>;
}): void => {
  for (const forbiddenSubstring of forbiddenGeneratedSubstrings) {
    assert.notInclude(response.answer, forbiddenSubstring);
    for (const warning of response.warnings) {
      assert.notInclude(warning, forbiddenSubstring);
    }
  }
};

describe("core recall", () => {
  afterAll(() => CoreRecallRuntime.dispose());

  it("normalizes Markdown and wikilinks before case-insensitive de-duplication", () => {
    assert.strictEqual(
      normalizeForDeduplication("  **Use** `[[notes/alpha-latency-budget|Alpha budget]]`  "),
      normalizeForDeduplication("use Alpha budget"),
    );
  });

  it.effect("answers the combined Alpha fixture question with applicable user preference", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: alphaQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.question, alphaQuestion);
        assert.deepStrictEqual(response.warnings, []);
        assert.include(response.answer, "200ms p95");
        assert.strictEqual(occurrenceCount(response.answer, "200ms p95"), 1);
        assert.include(response.answer, "stack-ranked");
        assert.include(response.answer, "capital-letter");
        assert.notInclude(response.answer, "5 second batch retry window");
        assert.notInclude(response.answer, "**");
        assert.notInclude(response.answer, "[[");
        assert.notInclude(response.answer, "`");
      }),
    ),
  );

  it.effect("answers project and preference facts without fixture-specific values", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-generic-",
          });

          yield* fs.makeDirectory(path.join(vaultPath, "projects"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "USER.md"),
            "# User\n\nFormat choices as numbered options with a one-line rationale.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "delta-service.md"),
            `---
aliases:
  - Delta API
---

# Delta Service

Delta Service requests should use a 750ms timeout ceiling.
`,
          );

          return yield* recall({
            vaultPath,
            question: "For Delta API, what timeout should I use, and how should I format choices?",
            includeSources: false,
          });
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "750ms timeout ceiling");
        assert.include(response.answer, "numbered options");
        assert.include(response.answer, "one-line rationale");
      }),
    ),
  );

  it.effect("allows one file to answer distinct requested fact categories", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-categories-",
          });

          yield* fs.makeDirectory(path.join(vaultPath, "projects"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "USER.md"),
            `# User

Alpha Product retry scheduling should use a **200ms p95 latency budget**. When presenting prioritization options, use **stack-ranked capital-letter choices**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "alpha-product.md"),
            "# Alpha Product\n",
          );

          return yield* recall({
            vaultPath,
            question:
              "For Alpha Product retry scheduling, what latency budget should I use, and how should I present prioritization options?",
            includeSources: false,
          });
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "200ms p95");
        assert.include(response.answer, "stack-ranked capital-letter choices");
        assert.strictEqual(occurrenceCount(response.answer, "200ms p95"), 1);
      }),
    ),
  );

  it.effect("answers Alpha latency questions without Beta or user-option leakage", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: alphaLatencyOnlyQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.question, alphaLatencyOnlyQuestion);
        assert.include(response.answer, "200ms p95");
        assert.notInclude(response.answer, "5 second batch retry window");
        assert.notInclude(response.answer, "stack-ranked");
        assert.notInclude(response.answer, "capital-letter");
      }),
    ),
  );

  it.effect("answers Beta retry policy questions without Alpha leakage", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: betaRetryPolicyQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.question, betaRetryPolicyQuestion);
        assert.include(response.answer, "5 second batch retry window");
        assert.notInclude(response.answer, "200ms p95");
        assert.notInclude(response.answer, "stack-ranked");
        assert.notInclude(response.answer, "capital-letter");
      }),
    ),
  );

  it.effect("answers user option-format questions without project fact leakage", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: userOptionFormatQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.question, userOptionFormatQuestion);
        assert.include(response.answer, "stack-ranked");
        assert.include(response.answer, "capital-letter");
        assert.notInclude(response.answer, "200ms p95");
        assert.notInclude(response.answer, "5 second batch retry window");
      }),
    ),
  );

  it.effect("returns not_found for unknown project questions instead of guessing", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: unknownProjectQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "not_found");
        assert.strictEqual(response.question, unknownProjectQuestion);
        assert.include(response.answer, "I don't know");
        assert.notInclude(response.answer, "200ms p95");
        assert.notInclude(response.answer, "5 second batch retry window");
        assert.notInclude(response.answer, "stack-ranked");
        assert.notInclude(response.answer, "capital-letter");
        assert.deepStrictEqual(response.warnings, []);
        assertGeneratedFieldsDoNotLeak(response);
      }),
    ),
  );

  it.effect("excludes source-only verification facts by default", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: sourceVerificationQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "not_found");
        assert.notInclude(response.answer, "180ms observed p95 verification threshold");
        assert.notInclude(response.answer, "120ms p95");
        assertGeneratedFieldsDoNotLeak(response);
      }),
    ),
  );

  it.effect("does not validate excluded unsafe sources but validates included sources", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-unsafe-source-",
          });
          const vaultPath = path.join(root, "vault");
          const outsidePath = path.join(root, "outside.md");

          yield* fs.makeDirectory(path.join(vaultPath, "sources"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(outsidePath, "# Outside\n\nUnsafe source fact.\n");
          yield* fs.symlink(outsidePath, path.join(vaultPath, "sources", "outside.md"));

          const response = yield* recall({
            vaultPath,
            question: "What unsafe source fact was recorded?",
            includeSources: false,
          });
          assert.strictEqual(response.status, "not_found");

          const error = yield* recall({
            vaultPath,
            question: "What unsafe source fact was recorded?",
            includeSources: true,
          }).pipe(Effect.flip);
          assert.strictEqual(error.reason, "ReadVaultFailed");
          assert.include(error.message, "sources/outside.md");
        }),
      ),
    ),
  );

  it.effect(
    "makes source facts eligible only when explicitly included without leaking internals",
    () =>
      withCoreRecallRuntime(
        recall({
          vaultPath: fixtureVaultPath,
          question: sourceVerificationQuestion,
          includeSources: true,
        }),
      ).pipe(
        Effect.map((response) => {
          assert.strictEqual(response.status, "answered");
          assert.include(response.answer, "180ms observed p95 verification threshold");
          assert.strictEqual(
            occurrenceCount(response.answer, "180ms observed p95 verification threshold"),
            1,
          );
          assert.notInclude(response.answer, "120ms p95");
          assert.deepStrictEqual(Object.keys(response).toSorted(), [
            "answer",
            "question",
            "status",
            "warnings",
          ]);
          assertGeneratedFieldsDoNotLeak(response);
        }),
      ),
  );

  it.effect(
    "keeps active curated memory ahead of sources for ordinary included-source recall",
    () =>
      withCoreRecallRuntime(
        recall({
          vaultPath: fixtureVaultPath,
          question: alphaLatencyOnlyQuestion,
          includeSources: true,
        }),
      ).pipe(
        Effect.map((response) => {
          assert.strictEqual(response.status, "answered");
          assert.include(response.answer, "200ms p95");
          assert.notInclude(response.answer, "120ms p95");
          assert.notInclude(response.answer, "180ms observed p95 verification threshold");
          assertGeneratedFieldsDoNotLeak(response);
        }),
      ),
  );

  it.effect("prefers active memory over stale and archived conflicting facts", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-status-",
          });

          yield* Effect.forEach(
            ["notes", "projects", "records"] satisfies ReadonlyArray<string>,
            (relativePath) =>
              fs.makeDirectory(path.join(vaultPath, relativePath), { recursive: true }),
          );
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# USER\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "alpha-product.md"),
            `---
type: project
status: active
project_status: active
summary: "Current Alpha Product scheduler decision."
aliases:
  - "Alpha Product"
---

# Alpha Product

The current Alpha Product retry scheduler uses a **200ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "alpha-archive.md"),
            `---
type: project
status: active
project_status: archived
summary: "Archived Alpha Product scheduler project."
aliases:
  - "Alpha Product"
---

# Archived Alpha Product

The archived Alpha Product retry scheduler project used a **450ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "alpha-latency-stale.md"),
            `---
type: note
status: stale
summary: "Stale current Alpha Product retry scheduler latency budget."
aliases:
  - "Stale Alpha Latency"
---

# Stale Alpha Latency

Stale guidance called **350ms p95** the current Alpha Product retry scheduler latency budget.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "records", "alpha-latency-archived.md"),
            `---
type: record
status: archived
summary: "Archived Alpha Product retry scheduler latency budget."
aliases:
  - "Archived Alpha Latency"
---

# Archived Alpha Latency

An archived record used a **400ms p95 latency budget** for the Alpha Product retry scheduler.
`,
          );

          return yield* recall({
            vaultPath,
            question: alphaLatencyOnlyQuestion,
            includeSources: false,
          });
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "200ms p95");
        assert.notInclude(response.answer, "350ms p95");
        assert.notInclude(response.answer, "400ms p95");
        assert.notInclude(response.answer, "450ms p95");
      }),
    ),
  );

  it.effect("uses route-only timing terms to answer from the linked note", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: "I am changing Alpha retry scheduler timing. What constraint matters?",
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "200ms p95");
        assert.strictEqual(occurrenceCount(response.answer, "200ms p95"), 1);
        assert.notInclude(response.answer, "Read when");
        assert.notInclude(response.answer, "changing scheduler timing");
        assert.notInclude(response.answer, "5 second batch retry window");
      }),
    ),
  );

  it.effect("follows a rationale route to the linked decision record", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: "Why was the Alpha scheduler latency budget chosen?",
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "user-facing flows");
        assert.notInclude(response.answer, "Read when");
        assert.notInclude(response.answer, "5 second batch retry window");
      }),
    ),
  );

  it.effect("answers directly from the project decision log", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: "What accepted Alpha retry scheduler latency budget is in the decision log?",
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "200ms p95");
        assert.notInclude(response.answer, "Read when");
      }),
    ),
  );

  it.effect("answers directly from project resume context when it is the best block", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question:
          "Before resuming Alpha scheduler work, what constraint matters for user-facing scheduling?",
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "preserve responsiveness over throughput");
        assert.notInclude(response.answer, "Read when");
      }),
    ),
  );

  it.effect("uses a root route to discover answer-bearing downstream context", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question:
          "For Alpha user-facing planning context, what scheduler constraint should I follow?",
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "interaction-design constraints");
        assert.notInclude(response.answer, "Root routes");
        assert.notInclude(response.answer, "5 second batch retry window");
      }),
    ),
  );

  it.effect("allows answer-worthy map framing to win", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: "How does Alpha frame scheduler choices: interaction design or background jobs?",
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.include(response.answer, "interaction-design constraints");
        assert.include(response.answer, "not background-job tuning");
        assert.notInclude(response.answer, "Read when");
      }),
    ),
  );

  it.effect("rejects whitespace-only questions before reading the vault", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: "/vault/that/should/not/be/read",
        question: " \n\t ",
        includeSources: false,
      }).pipe(Effect.exit),
    ).pipe(
      Effect.map((exit) => {
        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const reason = exit.cause.reasons[0];
          assert.isTrue(reason !== undefined && Cause.isFailReason(reason));
          if (reason !== undefined && Cause.isFailReason(reason)) {
            const error = reason.error;
            assert.strictEqual(error._tag, "RecallError");
            assert.strictEqual(error.reason, "InvalidQuestion");
          }
        }
      }),
    ),
  );

  it.effect("ignores control-plane files and prefers curated memory over raw sources", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-",
          });

          yield* Effect.forEach(
            [
              ".agentic-memory",
              ".agentic-memory-link",
              ".cache",
              ".git",
              ".obsidian",
              "notes",
              "sources",
            ] satisfies ReadonlyArray<string>,
            (relativePath) =>
              fs.makeDirectory(path.join(vaultPath, relativePath), { recursive: true }),
          );
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "USER.md"),
            `# User

- When presenting prioritization options, use stack-ranked capital-letter choices.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "alpha-latency-budget.md"),
            `# Alpha Latency Budget

Alpha Product interactive retry scheduling should use a **200ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "sources", "alpha-scheduler-source.md"),
            `# Alpha Scheduler Source

Alpha Product interactive retry scheduling should use a **100ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory", "control-plane.md"),
            `# Control Plane

Alpha Product interactive retry scheduling should use a **1ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".agentic-memory-link", "generated.md"),
            "Alpha Product should use a 2ms p95 latency budget.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".cache", "generated.md"),
            "Alpha Product should use a 3ms p95 latency budget.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".git", "generated.md"),
            "Alpha Product should use a 4ms p95 latency budget.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, ".obsidian", "generated.md"),
            "Alpha Product should use a 5ms p95 latency budget.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "AGENTS.md"),
            "Alpha Product should use a 6ms p95 latency budget.\n",
          );

          return yield* recall({
            vaultPath,
            question: alphaQuestion,
            includeSources: false,
          });
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.include(response.answer, "200ms p95");
        assert.include(response.answer, "stack-ranked");
        assert.include(response.answer, "capital-letter");
        assert.notInclude(response.answer, "100ms p95");
        for (const excludedFact of [
          "1ms p95",
          "2ms p95",
          "3ms p95",
          "4ms p95",
          "5ms p95",
          "6ms p95",
        ]) {
          assert.notInclude(response.answer, excludedFact);
        }
      }),
    ),
  );

  it.effect("keeps generated answers free of managed paths and wikilink syntax", () =>
    withCoreRecallRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-core-recall-leaks-",
          });

          yield* Effect.forEach(
            [
              ".agentic-memory",
              "maps",
              "notes",
              "projects",
              "records",
              "sources",
            ] satisfies ReadonlyArray<string>,
            (relativePath) =>
              fs.makeDirectory(path.join(vaultPath, relativePath), { recursive: true }),
          );
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# MEMORY\n");
          yield* fs.writeFileString(
            path.join(vaultPath, "USER.md"),
            `# USER

USER.md, projects/alpha-product.md, notes/user-option-format.md, [[notes/user-option-format]], .agentic-memory, LexicalProvider, and QMD guidance all say to present options as **stack-ranked capital-letter choices**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "alpha-latency-budget.md"),
            `# Alpha Latency Budget

MEMORY.md, maps/alpha-product.md, records/2026-07-01-alpha-scheduler-decision.md, and sources/alpha-scheduler-source.md all confirm Alpha Product interactive retry scheduling should follow a **200ms p95 latency budget**.
`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "projects", "alpha-product.md"),
            "# Alpha Product\n",
          );

          return yield* recall({
            vaultPath,
            question: leakProbeQuestion,
            includeSources: false,
          });
        }),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.include(response.question, "MEMORY.md");
        assert.include(response.question, ".agentic-memory");
        assert.include(response.answer, "200ms p95");
        assert.include(response.answer, "stack-ranked");
        assert.include(response.answer, "capital-letter");
        assertGeneratedFieldsDoNotLeak(response);
      }),
    ),
  );

  it.effect("keeps generated warnings free of control-plane names", () =>
    withCoreRecallRuntime(
      recall({
        vaultPath: fixtureVaultPath,
        question: leakProbeQuestion,
        includeSources: false,
      }),
    ).pipe(
      Effect.map((response) => {
        assert.include(response.question, ".agentic-memory");
        assert.deepStrictEqual(response.warnings, []);
        assertGeneratedFieldsDoNotLeak(response);
      }),
    ),
  );
});
