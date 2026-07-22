import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EmbeddingModel,
  makeEmbeddingModel,
} from "../src/semantic/EmbeddingModel.ts";
import {
  CHUNKING_VERSION,
  chunkManagedMemoryDocument,
  fingerprintSemanticIndexCompatibility,
  formatDocumentEmbeddingInput,
  formatQueryEmbeddingInput,
  SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
} from "../src/semantic/MarkdownChunking.ts";
import {
  deleteSemanticIndex,
  inspectSemanticIndex,
  synchronizeSemanticIndex,
} from "../src/semantic/SemanticIndex.ts";
import {
  readSemanticIndexSnapshot,
  searchSemanticIndexExact,
} from "../src/semantic/SemanticIndexRepository.ts";
import {
  classifyManagedMemoryLayer,
  hashManagedMemoryContent,
  isManagedMemoryPath,
  parseManagedMemoryDocument,
  readManagedMemoryDocuments,
} from "../src/vault/ManagedMemory.ts";

interface FakeModelControl {
  calls: number;
}

const fakeVector = (text: string): ReadonlyArray<number> =>
  Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
    index === 0
      ? text.includes("unique-nearest")
        ? 1
        : 0
      : index === 1
        ? text.includes("secondary-nearest")
          ? 1
          : 0
        : index === 2
          ? 1
          : 0,
  );

const makeControlledModelLayer = (control: FakeModelControl): Layer.Layer<EmbeddingModel> =>
  Layer.succeed(
    EmbeddingModel,
    makeEmbeddingModel({
      inspect: Effect.succeed({ status: "available", id: "embeddinggemma-300M-Q8_0" }),
      install: Effect.succeed({
        status: "already_available",
        id: "embeddinggemma-300M-Q8_0",
      }),
      embed: (texts) => {
        control.calls += 1;
        return Effect.succeed(texts.map(fakeVector));
      },
    }),
  );

const withServices = <A, E, R>(
  control: FakeModelControl,
  effect: Effect.Effect<A, E, R | EmbeddingModel | BunServices.BunServices>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.merge(BunServices.layer, makeControlledModelLayer(control)),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const writeVault = Effect.fnUntraced(function* (vaultPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.join(vaultPath, ".agentic-memory"), { recursive: true });
  yield* fs.makeDirectory(path.join(vaultPath, "notes"), { recursive: true });
  yield* fs.makeDirectory(path.join(vaultPath, "sources"), { recursive: true });
  yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n\nRoot context.\n");
  yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n\nOwner context.\n");
  yield* fs.writeFileString(
    path.join(vaultPath, "notes", "nearest.md"),
    "---\ntype: note\nstatus: active\n---\n# Nearest\n\nunique-nearest durable fact.\n",
  );
  yield* fs.writeFileString(
    path.join(vaultPath, "sources", "evidence.md"),
    "---\ntype: source\n---\n# Evidence\n\nsecondary-nearest captured evidence.\n",
  );
});

describe("managed memory inventory", () => {
  it("owns managed-path classification and stable content hashing", () => {
    assert.strictEqual(classifyManagedMemoryLayer("MEMORY.md"), "core");
    assert.strictEqual(classifyManagedMemoryLayer("sources/evidence.md"), "source");
    assert.isTrue(isManagedMemoryPath("notes/nested/fact.md"));
    assert.isFalse(isManagedMemoryPath("AGENTS.md"));
    assert.isFalse(isManagedMemoryPath(".agentic-memory/private.md"));
    assert.isFalse(isManagedMemoryPath("misc/fact.md"));
    assert.strictEqual(hashManagedMemoryContent("same"), hashManagedMemoryContent("same"));
    assert.notStrictEqual(hashManagedMemoryContent("same"), hashManagedMemoryContent("changed"));
  });

  it.effect("inventory and indexing reject unsafe source symlinks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "managed-memory-symlink-" });
        const vaultPath = path.join(root, "vault");
        const outsidePath = path.join(root, "outside.md");
        yield* fs.makeDirectory(path.join(vaultPath, "sources"), { recursive: true });
        yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
        yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
        yield* fs.writeFileString(outsidePath, "# Outside\n");
        yield* fs.symlink(outsidePath, path.join(vaultPath, "sources", "outside.md"));
        const error = yield* readManagedMemoryDocuments(vaultPath).pipe(Effect.flip);
        assert.strictEqual(error.reason, "UnsafeManagedPath");

        const indexError = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);
        assert.strictEqual(indexError.reason, "InvalidVaultStructure");
        assert.include(indexError.message, "sources/outside.md");
      }),
    ).pipe((effect) => withServices({ calls: 0 }, effect)),
  );
});

describe("semantic Markdown chunking", () => {
  it("rejects indexes built with the superseded chunking algorithm", () => {
    const rejectedChunkingFingerprint =
      "4f9586295899ab9d81a37c98f8d033ffcb043241470e86aeee90b2f0532f59c6";
    assert.strictEqual(CHUNKING_VERSION, "markdown-heading-paragraph-v8");
    assert.notStrictEqual(SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT, rejectedChunkingFingerprint);
  });

  it("includes embedding dimensions in the compatibility identity", () => {
    const rejectedSubmittedDimensionlessFingerprint =
      "04184625af99df8cad2aa035f4cee55d0e493a2e12ab318ff52aaebdba334dfc";
    const rejectedCurrentDimensionlessFingerprint =
      "d969da89b49471d5bb6304dfe4325bcf57447982cd493fa637fbcfe5d4c54096";

    assert.strictEqual(
      SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
      "53f7b6c149e4041125fc87ed84adaedece0b86d78c4a70910630a676b92f944d",
    );
    assert.notStrictEqual(
      SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
      fingerprintSemanticIndexCompatibility(EMBEDDING_MODEL_DIMENSIONS + 1),
    );
    assert.notStrictEqual(
      SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
      rejectedSubmittedDimensionlessFingerprint,
    );
    assert.notStrictEqual(
      SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT,
      rejectedCurrentDimensionlessFingerprint,
    );
  });

  it("removes frontmatter, preserves heading hierarchy and source lines, and formats prompts", () => {
    const content = `---
type: note
status: active
---
# Document title

Intro paragraph.

## Decision

Use the durable choice.

\`\`\`md
# Not a heading
\`\`\`
`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/example.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed);
    assert.strictEqual(parsed.bodyStartLine, 5);
    assert.strictEqual(parsed.status, "active");
    assert.strictEqual(chunks.length, 2);
    assert.deepStrictEqual(chunks[0]?.headingPath, ["Document title"]);
    assert.deepStrictEqual(chunks[1]?.headingPath, ["Document title", "Decision"]);
    assert.strictEqual(chunks[1]?.startLine, 11);
    assert.strictEqual(chunks[1]?.endLine, 15);
    assert.notInclude(chunks[0]?.text ?? "", "type: note");
    assert.include(chunks[1]?.text ?? "", "# Not a heading");
    assert.strictEqual(
      chunks[1]?.embeddingInput,
      formatDocumentEmbeddingInput(
        "Document title",
        ["Document title", "Decision"],
        "Use the durable choice.\n\n```md\n# Not a heading\n```",
      ),
    );
    assert.strictEqual(
      formatQueryEmbeddingInput("Where is it?"),
      "task: search result | query: Where is it?",
    );
  });

  it("splits oversized paragraphs deterministically with overlap", () => {
    const content = `# Large\n\n${Array.from({ length: 80 }, (_, index) => `word-${index}`).join(" ")}\n`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/large.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const first = chunkManagedMemoryDocument(parsed, { targetTokens: 20, overlapPercent: 15 });
    const second = chunkManagedMemoryDocument(parsed, { targetTokens: 20, overlapPercent: 15 });
    assert.isAbove(first.length, 1);
    assert.deepStrictEqual(first, second);
    assert.isTrue(first.every((chunk) => Math.ceil(chunk.text.length / 4) <= 20));
    const firstWords = first[0]?.text.split(/\s+/u) ?? [];
    const secondWords = first[1]?.text.split(/\s+/u) ?? [];
    assert.strictEqual(firstWords.at(-1), secondWords[0]);
    assert.isTrue(first.every((chunk) => chunk.startLine === 3 && chunk.endLine === 3));
    assert.isNotEmpty(SEMANTIC_INDEX_COMPATIBILITY_FINGERPRINT);
  });

  it("preserves multiline source ranges through splits and overlap", () => {
    const content = `# Large\n\n${Array.from({ length: 120 }, (_, index) => `line-${index}`).join("\n")}\n`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/multiline-large.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed, { targetTokens: 40, overlapPercent: 15 });

    assert.isAbove(chunks.length, 2);
    assert.isTrue(
      chunks.every((chunk) => {
        const lineIndexes = chunk.text
          .split(/\s+/u)
          .map((word) => Number(word.replace("line-", "")));
        return (
          chunk.startLine === 3 + (lineIndexes[0] ?? -1) &&
          chunk.endLine === 3 + (lineIndexes.at(-1) ?? -1)
        );
      }),
    );
    assert.notDeepEqual(
      [chunks[0]?.startLine, chunks[0]?.endLine],
      [chunks[1]?.startLine, chunks[1]?.endLine],
    );
    assert.isBelow(
      chunks[1]?.startLine ?? Number.MAX_SAFE_INTEGER,
      chunks[0]?.endLine ?? Number.MIN_SAFE_INTEGER,
    );
  });

  it("keeps default-sized oversized paragraph windows within the target", () => {
    const content = `# Large\n\n${Array.from({ length: 1_200 }, (_, index) => `word-${index}`).join(" ")}\n`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/default-large.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed);
    assert.isAbove(chunks.length, 1);
    assert.isTrue(chunks.every((chunk) => Math.ceil(chunk.text.length / 4) <= 900));
    assert.isTrue(chunks.every((chunk) => chunk.startLine === 3 && chunk.endLine === 3));
  });

  it("budgets complete embedding inputs with substantial heading overhead", () => {
    const heading = "H".repeat(800);
    const content = `# ${heading}\n\n${Array.from({ length: 1_200 }, (_, index) => `word-${index}`).join(" ")}\n`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/heading-overhead.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed);
    assert.isAbove(chunks.length, 1);
    assert.isTrue(chunks.every((chunk) => Math.ceil(chunk.embeddingInput.length / 4) <= 900));
  });

  it("retains overlap when prompt overhead constrains body capacity", () => {
    const heading = "H".repeat(1_600);
    const content = `# ${heading}\n\n${Array.from({ length: 1_200 }, (_, index) => `word-${index}`).join(" ")}\n`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/constrained-overlap.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const first = chunkManagedMemoryDocument(parsed);
    const second = chunkManagedMemoryDocument(parsed);

    assert.isAbove(first.length, 1);
    assert.deepStrictEqual(first, second);
    assert.isTrue(first.every((chunk) => Math.ceil(chunk.embeddingInput.length / 4) <= 900));
    assert.isTrue(
      first.slice(1).every((chunk, index) => {
        const previousWords = first[index]?.text.split(/\s+/u) ?? [];
        const currentWords = chunk.text.split(/\s+/u);
        const maximumOverlap = Math.min(previousWords.length, currentWords.length);
        return Array.from({ length: maximumOverlap }, (_, offset) => offset + 1).some(
          (overlapLength) =>
            previousWords
              .slice(-overlapLength)
              .every((word, wordIndex) => word === currentWords[wordIndex]),
        );
      }),
    );
  });

  it("bounds body windows when fixed prompt overhead exhausts the target", () => {
    const heading = "H".repeat(1_800);
    const content = `# ${heading}\n\n${Array.from({ length: 1_200 }, (_, index) => `word-${index}`).join(" ")}\n`;
    const parsed = parseManagedMemoryDocument({
      path: "notes/irreducible-heading-overhead.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed);
    const unavoidableOverheadTokens = Math.ceil(
      formatDocumentEmbeddingInput(parsed.title, [heading], "").length / 4,
    );

    assert.strictEqual(chunks.length, 1_200);
    assert.strictEqual(chunks[0]?.text, "word-0");
    assert.strictEqual(chunks.at(-1)?.text, "word-1199");
    assert.isTrue(chunks.every((chunk) => chunk.text.split(/\s+/u).length === 1));
    assert.isTrue(
      chunks.every(
        (chunk) =>
          Math.ceil(chunk.embeddingInput.length / 4) <=
          unavoidableOverheadTokens + Math.ceil(chunk.text.length / 4),
      ),
    );
    assert.isTrue(chunks.every((chunk) => chunk.startLine === 3 && chunk.endLine === 3));
  });

  it("keeps skipped heading levels dense in paths and prompts", () => {
    const content = "# One\n\nRoot.\n\n### Three\n\nNested.\n";
    const parsed = parseManagedMemoryDocument({
      path: "notes/skipped-heading.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed);
    assert.deepStrictEqual(chunks[1]?.headingPath, ["One", "Three"]);
    assert.include(chunks[1]?.embeddingInput ?? "", "One > Three");
    assert.notInclude(chunks[1]?.embeddingInput ?? "", ">  >");
  });

  it("recognizes up to three leading spaces on ATX headings", () => {
    for (const indentation of [0, 1, 2, 3]) {
      const content = `# Root\n\nRoot body.\n\n${" ".repeat(indentation)}## Nested\n\nNested body.\n`;
      const parsed = parseManagedMemoryDocument({
        path: `notes/atx-indent-${indentation}.md`,
        memoryLayer: "note",
        content,
        contentHash: hashManagedMemoryContent(content),
      });
      const first = chunkManagedMemoryDocument(parsed);
      const second = chunkManagedMemoryDocument(parsed);

      assert.deepStrictEqual(first, second);
      assert.deepStrictEqual(
        first.map(({ headingPath, startLine, endLine }) => ({ headingPath, startLine, endLine })),
        [
          { headingPath: ["Root"], startLine: 3, endLine: 3 },
          { headingPath: ["Root", "Nested"], startLine: 7, endLine: 7 },
        ],
      );
    }

    const fourSpaceContent = "# Root\n\nRoot body.\n\n    ## Still body\n\nAfter.\n";
    const fourSpaceParsed = parseManagedMemoryDocument({
      path: "notes/atx-indent-4.md",
      memoryLayer: "note",
      content: fourSpaceContent,
      contentHash: hashManagedMemoryContent(fourSpaceContent),
    });
    const fourSpaceChunks = chunkManagedMemoryDocument(fourSpaceParsed);

    assert.strictEqual(fourSpaceChunks.length, 1);
    assert.deepStrictEqual(fourSpaceChunks[0]?.headingPath, ["Root"]);
    assert.strictEqual(fourSpaceChunks[0]?.startLine, 3);
    assert.strictEqual(fourSpaceChunks[0]?.endLine, 7);
    assert.include(fourSpaceChunks[0]?.text ?? "", "## Still body");
  });

  it("keeps shorter backtick and tilde fences nested in longer fences", () => {
    const fences: ReadonlyArray<"`" | "~"> = ["`", "~"];
    for (const fence of fences) {
      const outer = fence.repeat(4);
      const inner = fence.repeat(3);
      const content = `# Document\n\n${outer}md\n${inner}\n# Still code\n${inner}\n${outer}\n\n## After\n\nOutside.\n`;
      const parsed = parseManagedMemoryDocument({
        path: `notes/${fence === "`" ? "backtick" : "tilde"}-fence.md`,
        memoryLayer: "note",
        content,
        contentHash: hashManagedMemoryContent(content),
      });
      const chunks = chunkManagedMemoryDocument(parsed);

      assert.strictEqual(chunks.length, 2);
      assert.deepStrictEqual(chunks[0]?.headingPath, ["Document"]);
      assert.include(chunks[0]?.text ?? "", "# Still code");
      assert.deepStrictEqual(chunks[1]?.headingPath, ["Document", "After"]);
    }
  });

  it("preserves unspaced trailing hashes in ATX headings", () => {
    const content = "# C#\n\nLanguage.\n\n# C #\n\nClosed marker.\n";
    const parsed = parseManagedMemoryDocument({
      path: "notes/atx-closing-hashes.md",
      memoryLayer: "note",
      content,
      contentHash: hashManagedMemoryContent(content),
    });
    const chunks = chunkManagedMemoryDocument(parsed);

    assert.deepStrictEqual(
      chunks.map(({ headingPath }) => headingPath),
      [["C#"], ["C"]],
    );
  });
});

describe("semantic index workflow with native libSQL", () => {
  it.effect("creates the database at reserved-character vault paths", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const reservedCharacters = path.sep === "\\" ? ["#", "%"] : ["?", "#", "%"];

          for (const reservedCharacter of reservedCharacters) {
            const vaultPath = yield* fs.makeTempDirectoryScoped({
              prefix: `semantic-index-file-url-${reservedCharacter}-`,
            });
            yield* writeVault(vaultPath);

            const result = yield* synchronizeSemanticIndex(vaultPath);
            const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");

            assert.strictEqual(result.status, "indexed");
            assert.include(vaultPath, reservedCharacter);
            assert.isTrue(yield* fs.exists(databasePath));
          }
        }),
      ),
    );
  });

  it.effect("indexes every managed document and proves exact cosine ordering", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix: "semantic-index-e2e-" });
          yield* writeVault(vaultPath);

          const missing = yield* inspectSemanticIndex(vaultPath);
          assert.strictEqual(missing.status, "missing");
          const initial = yield* synchronizeSemanticIndex(vaultPath);
          assert.strictEqual(initial.status, "indexed");
          assert.strictEqual(initial.files.new, 4);
          assert.isAbove(initial.chunks.embedded, 0);
          assert.strictEqual(control.calls, 4);

          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const snapshot = yield* readSemanticIndexSnapshot(databasePath);
          assert.strictEqual(snapshot.metadata?.state, "complete");
          assert.strictEqual(snapshot.documents.length, 4);
          assert.isTrue(
            snapshot.documents.some(({ path: documentPath }) =>
              documentPath.startsWith("sources/"),
            ),
          );
          const query = Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
            index === 0 ? 1 : 0,
          );
          const ranked = yield* searchSemanticIndexExact(databasePath, query, 2);
          assert.strictEqual(ranked[0]?.documentPath, "notes/nearest.md");
          const inspection = yield* inspectSemanticIndex(vaultPath);
          assert.strictEqual(inspection.status, "complete");

          const deleted = yield* deleteSemanticIndex(vaultPath);
          assert.strictEqual(deleted.status, "deleted");
          assert.isTrue(yield* fs.exists(path.join(vaultPath, "MEMORY.md")));
        }),
      ),
    );
  });
});
