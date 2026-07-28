import * as BunServices from "@effect/platform-bun/BunServices";
import { createClient } from "@libsql/client";
import { assert, describe, it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Path,
  PlatformError,
} from "effect";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EmbeddingRuntimeError,
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
  requireCurrentSemanticIndex,
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
import { initVaultFromTemplate } from "../src/vault/VaultTemplate.ts";
import { VaultRepository, VaultRepositoryLive } from "../src/vault/VaultRepository.ts";

interface FakeModelControl {
  calls: number;
  availability?: "available" | "missing";
  failOnText?: string;
  inspections?: number;
  invalidVectors?: "wrong_dimension" | "non_finite";
}

const fakeFileInfo = (type: FileSystem.File.Type): FileSystem.File.Info => ({
  type,
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
});

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
      inspect: Effect.sync(() => {
        control.inspections = (control.inspections ?? 0) + 1;
        return {
          status: control.availability ?? "available",
          id: EMBEDDING_MODEL_ID,
        };
      }),
      install: Effect.succeed({
        status: "already_available",
        id: "embeddinggemma-300M-Q8_0",
      }),
      embed: (texts) => {
        control.calls += 1;
        return control.invalidVectors === "wrong_dimension"
          ? Effect.succeed(texts.map(() => [1]))
          : control.invalidVectors === "non_finite"
            ? Effect.succeed(
                texts.map(() =>
                  Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
                    index === 0 ? Number.NaN : 0,
                  ),
                ),
              )
            : control.failOnText !== undefined &&
                texts.some((text) => text.includes(control.failOnText ?? ""))
              ? Effect.fail(
                  new EmbeddingRuntimeError({ message: `Rejected ${control.failOnText} for test` }),
                )
              : Effect.succeed(texts.map(fakeVector));
      },
    }),
  );

const withServices = <A, E, R>(
  control: FakeModelControl,
  effect: Effect.Effect<A, E, R | EmbeddingModel | BunServices.BunServices | VaultRepository>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      BunServices.layer,
      makeControlledModelLayer(control),
      VaultRepositoryLive.pipe(Layer.provide(BunServices.layer)),
    ),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const writeVault = Effect.fnUntraced(function* (vaultPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* initVaultFromTemplate({
    targetPath: vaultPath,
    initializeGit: false,
    yes: true,
  });
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
  it.effect("rejects vaults missing a required content folder or control-plane template", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-incomplete-layout-",
          });
          const missingEntries = [
            { vaultName: "missing-maps", relativePath: "maps", warning: "maps/" },
            {
              vaultName: "missing-note-template",
              relativePath: path.join(".agentic-memory", "templates", "note.md"),
              warning: ".agentic-memory/templates/note.md",
            },
          ];

          for (const entry of missingEntries) {
            const vaultPath = path.join(tempRoot, entry.vaultName);
            yield* writeVault(vaultPath);
            yield* fs.remove(path.join(vaultPath, entry.relativePath), {
              recursive: entry.relativePath === "maps",
            });

            const readiness = yield* inspectSemanticIndex(vaultPath);

            assert.strictEqual(readiness.status, "invalid");
            assert.strictEqual(readiness.vault.status, "invalid");
            assert.strictEqual(readiness.model.status, "not_checked");
            assert.strictEqual(readiness.index.status, "invalid");
            assert.include(readiness.warnings.join(" "), entry.warning);
          }

          assert.strictEqual(control.calls, 0);
          assert.strictEqual(control.inspections ?? 0, 0);
        }),
      ),
    );
  });

  it.effect("rejects required vault entries with the wrong filesystem type", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-wrong-entry-type-",
          });
          const fileAsDirectoryVault = path.join(tempRoot, "file-as-directory");
          yield* writeVault(fileAsDirectoryVault);
          yield* fs.remove(path.join(fileAsDirectoryVault, "AGENTS.md"));
          yield* fs.makeDirectory(path.join(fileAsDirectoryVault, "AGENTS.md"));

          const fileAsDirectory = yield* inspectSemanticIndex(fileAsDirectoryVault);
          assert.strictEqual(fileAsDirectory.status, "invalid");
          assert.strictEqual(fileAsDirectory.vault.status, "invalid");
          assert.strictEqual(fileAsDirectory.model.status, "not_checked");
          assert.strictEqual(fileAsDirectory.index.status, "invalid");
          assert.include(fileAsDirectory.warnings.join(" "), "AGENTS.md must be a file");

          const directoryAsFileVault = path.join(tempRoot, "directory-as-file");
          yield* writeVault(directoryAsFileVault);
          yield* fs.remove(path.join(directoryAsFileVault, "maps"), { recursive: true });
          yield* fs.writeFileString(path.join(directoryAsFileVault, "maps"), "not a directory\n");

          const directoryAsFile = yield* inspectSemanticIndex(directoryAsFileVault);
          assert.strictEqual(directoryAsFile.status, "invalid");
          assert.strictEqual(directoryAsFile.vault.status, "invalid");
          assert.strictEqual(directoryAsFile.model.status, "not_checked");
          assert.strictEqual(directoryAsFile.index.status, "invalid");
          assert.include(directoryAsFile.warnings.join(" "), "maps/ must be a directory");
          assert.strictEqual(control.calls, 0);
          assert.strictEqual(control.inspections ?? 0, 0);
        }),
      ),
    );
  });

  it.effect("rejects a directory without the initialized vault control plane", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-invalid-vault-",
          });
          yield* fs.makeDirectory(path.join(vaultPath, "projects"), { recursive: true });
          yield* fs.writeFileString(path.join(vaultPath, "AGENTS.md"), "# Agents\n");
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");

          const readiness = yield* inspectSemanticIndex(vaultPath);

          assert.strictEqual(readiness.status, "invalid");
          assert.strictEqual(readiness.vault.status, "invalid");
          assert.strictEqual(readiness.model.status, "not_checked");
          assert.strictEqual(readiness.index.status, "invalid");
          assert.strictEqual(control.calls, 0);
          assert.strictEqual(control.inspections ?? 0, 0);
          assert.include(readiness.warnings.join(" "), ".agentic-memory");
        }),
      ),
    );
  });

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
          assert.strictEqual(missing.status, "not_ready");
          assert.strictEqual(missing.index.status, "missing");
          assert.deepStrictEqual(missing.index, {
            status: "missing",
            newFiles: 4,
            changedFiles: 0,
            deletedFiles: 0,
            unchangedFiles: 0,
          });
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
          const ranked = yield* searchSemanticIndexExact(databasePath, query, 2, "all");
          assert.strictEqual(ranked[0]?.documentPath, "notes/nearest.md");
          const inspection = yield* inspectSemanticIndex(vaultPath);
          assert.strictEqual(inspection.status, "ready");
          assert.strictEqual(inspection.index.status, "current");
          assert.isTrue(inspection.recallReady);

          const deleted = yield* deleteSemanticIndex(vaultPath);
          assert.strictEqual(deleted.status, "deleted");
          assert.isTrue(yield* fs.exists(path.join(vaultPath, "MEMORY.md")));
        }),
      ),
    );
  });

  it.effect("reports every readiness state with planner counts and guards future recall", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-readiness-",
          });
          yield* writeVault(vaultPath);

          const missing = yield* inspectSemanticIndex(vaultPath);
          assert.strictEqual(missing.status, "not_ready");
          assert.strictEqual(missing.model.status, "available");
          assert.deepStrictEqual(missing.index, {
            status: "missing",
            newFiles: 4,
            changedFiles: 0,
            deletedFiles: 0,
            unchangedFiles: 0,
          });

          yield* synchronizeSemanticIndex(vaultPath);
          const callsAfterIndex = control.calls;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const databaseBeforeInspection = yield* fs.readFile(databasePath);
          const ready = yield* requireCurrentSemanticIndex(vaultPath);
          const databaseAfterInspection = yield* fs.readFile(databasePath);
          assert.strictEqual(ready.status, "ready");
          assert.strictEqual(ready.index.status, "current");
          assert.deepStrictEqual(databaseAfterInspection, databaseBeforeInspection);

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "nearest.md"),
            "# Nearest\n\nChanged after indexing.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "added.md"),
            "# Added\n\nNew after indexing.\n",
          );
          yield* fs.remove(path.join(vaultPath, "sources", "evidence.md"));
          const stale = yield* inspectSemanticIndex(vaultPath);
          assert.strictEqual(stale.index.status, "stale");
          assert.deepStrictEqual(stale.index, {
            status: "stale",
            newFiles: 1,
            changedFiles: 1,
            deletedFiles: 1,
            unchangedFiles: 2,
          });

          const databaseUrl = yield* path.toFileUrl(databasePath);
          const inspections = yield* Effect.acquireUseRelease(
            Effect.sync(() => createClient({ url: databaseUrl.href, intMode: "number" })),
            (client) =>
              Effect.gen(function* () {
                yield* Effect.promise(() =>
                  client.execute("UPDATE index_metadata SET state = 'incomplete' WHERE id = 1"),
                );
                const incomplete = yield* inspectSemanticIndex(vaultPath);

                yield* Effect.promise(() =>
                  client.execute("UPDATE index_metadata SET schema_version = 999 WHERE id = 1"),
                );
                const incompatible = yield* inspectSemanticIndex(vaultPath);

                yield* Effect.promise(() =>
                  client.execute("UPDATE index_metadata SET schema_version = 'bad' WHERE id = 1"),
                );
                const databaseBeforeInvalidInspection = yield* fs.readFile(databasePath);
                const invalidIndex = yield* inspectSemanticIndex(vaultPath);
                const databaseAfterInvalidInspection = yield* fs.readFile(databasePath);
                return {
                  incomplete,
                  incompatible,
                  invalidIndex,
                  databaseBeforeInvalidInspection,
                  databaseAfterInvalidInspection,
                };
              }),
            (resource) => Effect.sync(() => resource.close()),
          );
          const {
            incomplete,
            incompatible,
            invalidIndex,
            databaseBeforeInvalidInspection,
            databaseAfterInvalidInspection,
          } = inspections;
          assert.strictEqual(incomplete.index.status, "incomplete");
          assert.strictEqual(incomplete.index.newFiles, 1);
          assert.strictEqual(incomplete.index.changedFiles, 1);
          assert.strictEqual(incomplete.index.deletedFiles, 1);
          assert.strictEqual(incompatible.index.status, "incompatible");
          assert.include(incompatible.warnings.join(" "), "--delete");
          assert.deepStrictEqual(invalidIndex.index, {
            status: "invalid",
            newFiles: 1,
            changedFiles: 1,
            deletedFiles: 1,
            unchangedFiles: 2,
          });
          assert.isFalse(invalidIndex.recallReady);
          assert.deepStrictEqual(databaseAfterInvalidInspection, databaseBeforeInvalidInspection);
          assert.strictEqual(control.calls, callsAfterIndex);

          yield* deleteSemanticIndex(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          control.availability = "missing";
          const callsBeforeGuard = control.calls;
          const unavailable = yield* inspectSemanticIndex(vaultPath);
          assert.strictEqual(unavailable.status, "not_ready");
          assert.strictEqual(unavailable.model.status, "missing");
          assert.strictEqual(unavailable.index.status, "current");
          const guardError = yield* requireCurrentSemanticIndex(vaultPath).pipe(Effect.flip);
          assert.strictEqual(guardError.reason, "SemanticIndexNotReady");
          assert.strictEqual(control.calls, callsBeforeGuard);
        }),
      ),
    );
  });

  it.effect("returns invalid vault observations without inspecting model or storage", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      inspectSemanticIndex("relative/vault").pipe(
        Effect.map((result) => {
          assert.strictEqual(result.status, "invalid");
          assert.strictEqual(result.vault.status, "invalid");
          assert.strictEqual(result.model.status, "not_checked");
          assert.strictEqual(result.index.status, "invalid");
          assert.isFalse(result.recallReady);
          assert.include(result.warnings.join(" "), "absolute");
          assert.strictEqual(control.calls, 0);
        }),
      ),
    );
  });

  it.effect("distinguishes missing vault structure from inventory read failures", () => {
    const control: FakeModelControl = { calls: 0 };
    const notFound = PlatformError.systemError({
      _tag: "NotFound",
      module: "FileSystem",
      method: "realPath",
      pathOrDescriptor: "/missing-vault",
    });
    const permissionDenied = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readDirectory",
      pathOrDescriptor: "/vault",
    });
    const requiredDirectorySuffixes = [
      "/maps",
      "/notes",
      "/people",
      "/projects",
      "/records",
      "/sources",
    ];
    const missingInventory = FileSystem.makeNoop({
      realPath: () => Effect.fail(notFound),
    });
    const failingInventory = FileSystem.makeNoop({
      exists: () => Effect.succeed(true),
      stat: (entryPath) =>
        Effect.succeed(
          fakeFileInfo(
            requiredDirectorySuffixes.some((suffix) => entryPath.endsWith(suffix))
              ? "Directory"
              : "File",
          ),
        ),
      realPath: (path) => Effect.succeed(path),
      readDirectory: () => Effect.fail(permissionDenied),
    });

    return withServices(
      control,
      Effect.gen(function* () {
        const missing = yield* inspectSemanticIndex("/missing-vault").pipe(
          Effect.provideService(FileSystem.FileSystem, missingInventory),
        );
        assert.strictEqual(missing.status, "invalid");
        assert.strictEqual(missing.vault.status, "invalid");
        assert.strictEqual(missing.model.status, "not_checked");

        const error = yield* inspectSemanticIndex("/vault").pipe(
          Effect.flip,
          Effect.provideService(FileSystem.FileSystem, failingInventory),
        );
        assert.strictEqual(error.reason, "IndexReadFailed");
        assert.strictEqual(error.cause, permissionDenied);
        assert.strictEqual(control.calls, 0);
      }),
    );
  });

  it.effect("classifies entries that disappear during type inspection as missing", () => {
    const control: FakeModelControl = { calls: 0, inspections: 0 };
    const notFound = PlatformError.systemError({
      _tag: "NotFound",
      module: "FileSystem",
      method: "stat",
      pathOrDescriptor: "/vault/AGENTS.md",
    });
    let inventoryCalls = 0;
    const disappearingEntry = FileSystem.makeNoop({
      exists: () => Effect.succeed(true),
      stat: () => Effect.fail(notFound),
      readDirectory: () => {
        inventoryCalls += 1;
        return Effect.succeed([]);
      },
    });

    return withServices(
      control,
      inspectSemanticIndex("/vault").pipe(
        Effect.map((result) => {
          assert.strictEqual(result.status, "invalid");
          assert.strictEqual(result.vault.status, "invalid");
          assert.strictEqual(result.model.status, "not_checked");
          assert.strictEqual(result.index.status, "invalid");
          assert.isFalse(result.recallReady);
          assert.include(result.warnings.join(" "), "AGENTS.md");
          assert.strictEqual(control.inspections, 0);
          assert.strictEqual(control.calls, 0);
          assert.strictEqual(inventoryCalls, 0);
        }),
        Effect.provideService(FileSystem.FileSystem, disappearingEntry),
      ),
    );
  });

  it.effect("preserves non-NotFound type inspection failures", () => {
    const control: FakeModelControl = { calls: 0, inspections: 0 };
    const permissionDenied = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "stat",
      pathOrDescriptor: "/vault/AGENTS.md",
    });
    let inventoryCalls = 0;
    const inaccessibleEntry = FileSystem.makeNoop({
      exists: () => Effect.succeed(true),
      stat: () => Effect.fail(permissionDenied),
      readDirectory: () => {
        inventoryCalls += 1;
        return Effect.succeed([]);
      },
    });

    return withServices(
      control,
      inspectSemanticIndex("/vault").pipe(
        Effect.flip,
        Effect.map((error) => {
          assert.strictEqual(error.reason, "IndexReadFailed");
          assert.strictEqual(error.cause, permissionDenied);
          assert.strictEqual(control.inspections, 0);
          assert.strictEqual(control.calls, 0);
          assert.strictEqual(inventoryCalls, 0);
        }),
        Effect.provideService(FileSystem.FileSystem, inaccessibleEntry),
      ),
    );
  });

  it.effect("rejects incomplete documents and mismatched owned chunk counts", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-document-integrity-",
          });
          yield* writeVault(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          const callsAfterIndex = control.calls;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const databaseUrl = yield* path.toFileUrl(databasePath);

          const inspections = yield* Effect.acquireUseRelease(
            Effect.sync(() => createClient({ url: databaseUrl.href, intMode: "number" })),
            (client) =>
              Effect.gen(function* () {
                yield* Effect.promise(() =>
                  client.execute(
                    "UPDATE documents SET complete = 0 WHERE path = 'notes/nearest.md'",
                  ),
                );
                const incomplete = yield* inspectSemanticIndex(vaultPath);
                const incompleteGuard = yield* requireCurrentSemanticIndex(vaultPath).pipe(
                  Effect.flip,
                );

                yield* Effect.promise(() =>
                  client.execute(
                    "UPDATE documents SET complete = 1 WHERE path = 'notes/nearest.md'",
                  ),
                );
                yield* Effect.promise(() =>
                  client.execute(
                    "DELETE FROM chunks WHERE document_path = 'notes/nearest.md' AND ordinal = 0",
                  ),
                );
                const mismatched = yield* inspectSemanticIndex(vaultPath);
                const mismatchedGuard = yield* requireCurrentSemanticIndex(vaultPath).pipe(
                  Effect.flip,
                );
                return { incomplete, incompleteGuard, mismatched, mismatchedGuard };
              }),
            (resource) => Effect.sync(() => resource.close()),
          );

          assert.strictEqual(inspections.incomplete.index.status, "incomplete");
          assert.isFalse(inspections.incomplete.recallReady);
          assert.strictEqual(inspections.incompleteGuard.reason, "IndexIncomplete");
          assert.strictEqual(inspections.mismatched.index.status, "invalid");
          assert.isFalse(inspections.mismatched.recallReady);
          assert.strictEqual(inspections.mismatchedGuard.reason, "InvalidIndex");
          assert.strictEqual(control.calls, callsAfterIndex);
        }),
      ),
    );
  });

  it.effect("plans no-op, add, change, and delete work from content hashes", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix: "semantic-index-plan-" });
          yield* writeVault(vaultPath);

          const initial = yield* synchronizeSemanticIndex(vaultPath);
          const callsAfterInitial = control.calls;
          const inspectionsAfterInitial = control.inspections;
          const current = yield* synchronizeSemanticIndex(vaultPath);
          assert.strictEqual(current.status, "already_current");
          assert.deepStrictEqual(current.files, {
            new: 0,
            changed: 0,
            deleted: 0,
            unchanged: 4,
          });
          assert.deepStrictEqual(current.chunks, { embedded: 0, removed: 0 });
          assert.strictEqual(control.calls, callsAfterInitial);
          assert.strictEqual(control.inspections, inspectionsAfterInitial);

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "added.md"),
            "# Added\n\nA new durable fact.\n",
          );
          const added = yield* synchronizeSemanticIndex(vaultPath);
          assert.deepStrictEqual(added.files, {
            new: 1,
            changed: 0,
            deleted: 0,
            unchanged: 4,
          });
          assert.strictEqual(added.chunks.embedded, 1);
          assert.strictEqual(control.calls, callsAfterInitial + 1);

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "nearest.md"),
            "# Nearest\n\nChanged durable fact.\n\n## More\n\nA second chunk.\n",
          );
          const changed = yield* synchronizeSemanticIndex(vaultPath);
          assert.deepStrictEqual(changed.files, {
            new: 0,
            changed: 1,
            deleted: 0,
            unchanged: 4,
          });
          assert.strictEqual(changed.chunks.embedded, 2);
          assert.strictEqual(changed.chunks.removed, 1);
          assert.strictEqual(control.calls, callsAfterInitial + 2);

          yield* fs.remove(path.join(vaultPath, "sources", "evidence.md"));
          const deleted = yield* synchronizeSemanticIndex(vaultPath);
          assert.deepStrictEqual(deleted.files, {
            new: 0,
            changed: 0,
            deleted: 1,
            unchanged: 4,
          });
          assert.deepStrictEqual(deleted.chunks, { embedded: 0, removed: 1 });
          assert.strictEqual(control.calls, callsAfterInitial + 2);
          assert.strictEqual(initial.status, "indexed");
          assert.isFalse(yield* fs.exists(path.join(vaultPath, ".agentic-memory", "index.lock")));
        }),
      ),
    );
  });

  it.effect("keeps failed replacements incomplete and finishes them on retry", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix: "semantic-index-retry-" });
          yield* writeVault(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const before = yield* readSemanticIndexSnapshot(databasePath);
          const originalHash = before.documents.find(
            ({ path }) => path === "notes/nearest.md",
          )?.contentHash;
          const callsBeforeFailure = control.calls;

          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "committed-before-failure.md"),
            "# Committed first\n\nThis document commits before the later replacement fails.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "nearest.md"),
            "# Nearest\n\nfail-replacement\n",
          );
          control.failOnText = "fail-replacement";
          const failure = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);
          assert.strictEqual(failure.reason, "InvalidEmbedding");
          assert.strictEqual(control.calls, callsBeforeFailure + 2);
          const failedSnapshot = yield* readSemanticIndexSnapshot(databasePath);
          assert.strictEqual(failedSnapshot.metadata?.state, "incomplete");
          assert.strictEqual(
            failedSnapshot.documents.find(({ path }) => path === "notes/nearest.md")?.contentHash,
            originalHash,
          );
          assert.strictEqual(
            failedSnapshot.documents.find(
              ({ path }) => path === "notes/committed-before-failure.md",
            )?.integrity,
            "complete",
          );
          assert.isFalse(yield* fs.exists(path.join(vaultPath, ".agentic-memory", "index.lock")));

          delete control.failOnText;
          const callsBeforeRetry = control.calls;
          const retried = yield* synchronizeSemanticIndex(vaultPath);
          assert.strictEqual(retried.status, "indexed");
          assert.deepStrictEqual(retried.files, {
            new: 0,
            changed: 1,
            deleted: 0,
            unchanged: 4,
          });
          assert.strictEqual(control.calls, callsBeforeRetry + 1);
          const completed = yield* readSemanticIndexSnapshot(databasePath);
          assert.strictEqual(completed.metadata?.state, "complete");
          assert.strictEqual(completed.documents.length, 5);
          assert.notStrictEqual(
            completed.documents.find(({ path }) => path === "notes/nearest.md")?.contentHash,
            originalHash,
          );
        }),
      ),
    );
  });

  it.effect.each([
    { invalidVectors: "wrong_dimension" as const, expected: "has dimension 1; expected 768" },
    { invalidVectors: "non_finite" as const, expected: "contains non-finite values" },
  ])("rejects $invalidVectors model output before persistence", ({ invalidVectors, expected }) => {
    const control: FakeModelControl = { calls: 0, invalidVectors };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-invalid-vector-",
          });
          yield* writeVault(vaultPath);

          const failure = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);

          assert.strictEqual(failure.reason, "InvalidEmbedding");
          assert.include(failure.message, expected);
          const path = yield* Path.Path;
          const snapshot = yield* readSemanticIndexSnapshot(
            path.join(vaultPath, ".agentic-memory", "index", "recall.db"),
          );
          assert.strictEqual(snapshot.metadata?.state, "incomplete");
          assert.deepStrictEqual(snapshot.documents, []);
          assert.isFalse(yield* fs.exists(path.join(vaultPath, ".agentic-memory", "index.lock")));
        }),
      ),
    );
  });

  it.effect("interrupts between document transactions and releases the shared lock", () => {
    const calls = { value: 0 };
    return Effect.gen(function* () {
      const secondDocumentStarted = yield* Deferred.make<void>();
      const interruptingModel = Layer.succeed(
        EmbeddingModel,
        makeEmbeddingModel({
          inspect: Effect.succeed({ status: "available", id: EMBEDDING_MODEL_ID }),
          install: Effect.succeed({ status: "already_available", id: EMBEDDING_MODEL_ID }),
          embed: (texts) => {
            calls.value += 1;
            return calls.value === 2
              ? Deferred.succeed(secondDocumentStarted, undefined).pipe(
                  Effect.andThen(Effect.never),
                )
              : Effect.succeed(texts.map(fakeVector));
          },
        }),
      );
      const runtime = ManagedRuntime.make(
        Layer.mergeAll(
          BunServices.layer,
          interruptingModel,
          VaultRepositoryLive.pipe(Layer.provide(BunServices.layer)),
        ),
      );
      const test = Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-interruption-",
          });
          yield* writeVault(vaultPath);
          const operation = synchronizeSemanticIndex(vaultPath);
          const fiber = yield* operation.pipe(Effect.forkChild({ startImmediately: true }));
          yield* Deferred.await(secondDocumentStarted);

          const busy = yield* operation.pipe(Effect.flip);
          assert.strictEqual(busy.reason, "IndexBusy");
          yield* Fiber.interrupt(fiber);

          const lockPath = path.join(vaultPath, ".agentic-memory", "index.lock");
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          assert.isFalse(yield* fs.exists(lockPath));
          const interrupted = yield* readSemanticIndexSnapshot(databasePath);
          assert.strictEqual(interrupted.metadata?.state, "incomplete");
          assert.strictEqual(interrupted.documents.length, 1);
          assert.strictEqual(interrupted.documents[0]?.integrity, "complete");

          const retried = yield* operation;
          assert.strictEqual(retried.status, "indexed");
          const complete = yield* readSemanticIndexSnapshot(databasePath);
          assert.strictEqual(complete.metadata?.state, "complete");
          assert.strictEqual(complete.documents.length, 4);
        }),
      );
      return yield* runtime.contextEffect.pipe(
        Effect.flatMap((context) => Effect.provideContext(test, context)),
        Effect.ensuring(runtime.disposeEffect),
      );
    });
  });

  it.effect.each(["corrupt", "unsupported"])(
    "reports a $databaseCase database as invalid readiness and incompatible synchronization",
    (databaseCase) => {
      const control: FakeModelControl = { calls: 0 };
      return withServices(
        control,
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const vaultPath = yield* fs.makeTempDirectoryScoped({
              prefix: `semantic-index-${databaseCase}-database-`,
            });
            yield* writeVault(vaultPath);
            const indexDirectory = path.join(vaultPath, ".agentic-memory", "index");
            const databasePath = path.join(indexDirectory, "recall.db");
            yield* fs.makeDirectory(indexDirectory, { recursive: true });
            if (databaseCase === "corrupt") {
              yield* fs.writeFileString(databasePath, "not a sqlite database");
            } else {
              const databaseUrl = yield* path.toFileUrl(databasePath);
              yield* Effect.acquireUseRelease(
                Effect.sync(() => createClient({ url: databaseUrl.href })),
                (client) =>
                  Effect.promise(() => client.execute("CREATE TABLE unrelated (id TEXT)")),
                (client) => Effect.sync(() => client.close()),
              );
            }

            const readiness = yield* inspectSemanticIndex(vaultPath).pipe(Effect.result);
            const failure = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);
            if (databaseCase === "corrupt") {
              assert.strictEqual(readiness._tag, "Failure");
              if (readiness._tag === "Failure") {
                assert.strictEqual(readiness.failure.reason, "IndexReadFailed");
              }
              assert.strictEqual(failure.reason, "IncompatibleIndex");
              assert.include(failure.message, "--delete");
            } else {
              assert.strictEqual(readiness._tag, "Success");
              if (readiness._tag === "Success") {
                assert.strictEqual(readiness.success.index.status, "invalid");
                assert.isFalse(readiness.success.recallReady);
                assert.include(readiness.success.warnings.join(" "), "--delete");
              }
              assert.strictEqual(failure.reason, "IncompatibleIndex");
              assert.include(failure.message, "--delete");
            }
            assert.strictEqual(control.calls, 0);
            assert.isFalse(yield* fs.exists(path.join(vaultPath, ".agentic-memory", "index.lock")));
          }),
        ),
      );
    },
  );

  it.effect.each([
    {
      incompatibility: "schema-version-only",
      updateSql: "UPDATE index_metadata SET schema_version = 999 WHERE id = 1",
    },
    {
      incompatibility: "compatibility-fingerprint-only",
      updateSql: "UPDATE index_metadata SET compatibility_fingerprint = 'old' WHERE id = 1",
    },
  ])(
    "rejects $incompatibility metadata with delete-then-index guidance",
    ({ incompatibility, updateSql }) => {
      const control: FakeModelControl = { calls: 0 };
      return withServices(
        control,
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const vaultPath = yield* fs.makeTempDirectoryScoped({
              prefix: "semantic-index-compat-",
            });
            yield* writeVault(vaultPath);
            yield* synchronizeSemanticIndex(vaultPath);
            const callsAfterInitial = control.calls;
            const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
            const before = yield* readSemanticIndexSnapshot(databasePath);
            const databaseUrl = yield* path.toFileUrl(databasePath);
            const client = yield* Effect.acquireRelease(
              Effect.sync(() => createClient({ url: databaseUrl.href, intMode: "number" })),
              (resource) => Effect.sync(() => resource.close()),
            );
            yield* Effect.promise(() => client.execute(updateSql));

            const error = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);
            assert.strictEqual(error.reason, "IncompatibleIndex");
            assert.include(error.message, "--delete");
            assert.strictEqual(control.calls, callsAfterInitial);

            const after = yield* readSemanticIndexSnapshot(databasePath);
            assert.strictEqual(after.metadata?.state, before.metadata?.state);
            assert.strictEqual(
              after.metadata?.inventoryFingerprint,
              before.metadata?.inventoryFingerprint,
            );
            if (incompatibility === "schema-version-only") {
              assert.strictEqual(after.metadata?.schemaVersion, 999);
              assert.strictEqual(
                after.metadata?.compatibilityFingerprint,
                before.metadata?.compatibilityFingerprint,
              );
            } else {
              assert.strictEqual(after.metadata?.schemaVersion, before.metadata?.schemaVersion);
              assert.strictEqual(after.metadata?.compatibilityFingerprint, "old");
            }
          }),
        ),
      );
    },
  );

  it.effect("rejects an existing index whose singleton metadata row is missing", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-missing-metadata-",
          });
          yield* writeVault(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          const callsAfterInitial = control.calls;
          const databasePath = path.join(vaultPath, ".agentic-memory", "index", "recall.db");
          const before = yield* readSemanticIndexSnapshot(databasePath);
          const query = Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
            index === 0 ? 1 : 0,
          );
          const vectorsBefore = yield* searchSemanticIndexExact(databasePath, query, 10, "all");
          const databaseUrl = yield* path.toFileUrl(databasePath);
          const client = yield* Effect.acquireRelease(
            Effect.sync(() => createClient({ url: databaseUrl.href, intMode: "number" })),
            (resource) => Effect.sync(() => resource.close()),
          );
          yield* Effect.promise(() => client.execute("DELETE FROM index_metadata WHERE id = 1"));

          const error = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);
          assert.strictEqual(error.reason, "IncompatibleIndex");
          assert.include(error.message, "--delete");
          assert.strictEqual(control.calls, callsAfterInitial);

          const after = yield* readSemanticIndexSnapshot(databasePath);
          const vectorsAfter = yield* searchSemanticIndexExact(databasePath, query, 10, "all");
          assert.deepStrictEqual(after.documents, before.documents);
          assert.deepStrictEqual(vectorsAfter, vectorsBefore);
          assert.isUndefined(after.metadata);
        }),
      ),
    );
  });

  it.effect("uses one lock for synchronization and idempotent deletion", () => {
    const control: FakeModelControl = { calls: 0 };
    return withServices(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix: "semantic-index-delete-" });
          yield* writeVault(vaultPath);
          yield* synchronizeSemanticIndex(vaultPath);
          const indexDirectory = path.join(vaultPath, ".agentic-memory", "index");
          const lockDirectory = path.join(vaultPath, ".agentic-memory", "index.lock");
          yield* fs.writeFileString(path.join(indexDirectory, "recall.db-wal"), "sidecar");
          yield* fs.writeFileString(path.join(indexDirectory, "recall.db-shm"), "sidecar");
          yield* fs.makeDirectory(lockDirectory);
          const synchronizeBusy = yield* synchronizeSemanticIndex(vaultPath).pipe(Effect.flip);
          const deleteBusy = yield* deleteSemanticIndex(vaultPath).pipe(Effect.flip);
          assert.strictEqual(synchronizeBusy.reason, "IndexBusy");
          assert.strictEqual(deleteBusy.reason, "IndexBusy");
          yield* fs.remove(lockDirectory, { recursive: true });

          const deleted = yield* deleteSemanticIndex(vaultPath);
          assert.strictEqual(deleted.status, "deleted");
          assert.isFalse(yield* fs.exists(indexDirectory));
          assert.isFalse(yield* fs.exists(lockDirectory));
          assert.isTrue(yield* fs.exists(path.join(vaultPath, "MEMORY.md")));
          const absent = yield* deleteSemanticIndex(vaultPath);
          assert.strictEqual(absent.status, "already_absent");
          assert.isFalse(yield* fs.exists(lockDirectory));
        }),
      ),
    );
  });

  it.effect(
    "rejects deletion through a control-plane symlink without modifying external state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({
            prefix: "semantic-index-unsafe-delete-",
          });
          const vaultPath = path.join(root, "vault");
          const externalControlPlane = path.join(root, "external-control-plane");
          const externalIndex = path.join(externalControlPlane, "index");
          const sharedModelCache = path.join(root, "shared-model-cache");
          const externalPaths = [
            externalControlPlane,
            externalIndex,
            path.join(externalIndex, "recall.db"),
            path.join(externalIndex, "recall.db-wal"),
            path.join(externalIndex, "recall.db-shm"),
            path.join(externalControlPlane, "sentinel.md"),
            sharedModelCache,
            path.join(sharedModelCache, "model.gguf"),
          ];

          yield* fs.makeDirectory(vaultPath);
          yield* fs.makeDirectory(externalIndex, { recursive: true });
          yield* fs.makeDirectory(sharedModelCache);
          yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
          yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
          yield* fs.writeFileString(path.join(externalIndex, "recall.db"), "database");
          yield* fs.writeFileString(path.join(externalIndex, "recall.db-wal"), "sidecar");
          yield* fs.writeFileString(path.join(externalIndex, "recall.db-shm"), "sidecar");
          yield* fs.writeFileString(path.join(externalControlPlane, "sentinel.md"), "sentinel");
          yield* fs.writeFileString(path.join(sharedModelCache, "model.gguf"), "model");
          yield* fs.symlink(externalControlPlane, path.join(vaultPath, ".agentic-memory"));

          const error = yield* deleteSemanticIndex(vaultPath).pipe(Effect.flip);
          assert.strictEqual(error.reason, "DeleteFailed");
          assert.include(error.message, "outside the vault");
          assert.isFalse(yield* fs.exists(path.join(externalControlPlane, "index.lock")));
          assert.isTrue(yield* fs.exists(path.join(vaultPath, "MEMORY.md")));
          assert.isTrue(yield* fs.exists(path.join(vaultPath, "USER.md")));
          for (const externalPath of externalPaths) {
            assert.isTrue(yield* fs.exists(externalPath));
          }
        }),
      ).pipe((effect) => withServices({ calls: 0 }, effect)),
  );
});
