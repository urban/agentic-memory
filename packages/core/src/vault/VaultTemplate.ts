import { bundledVaultTemplatePath } from "@urban/agentic-memory-vault-template/VaultTemplatePackage";
import { Effect, FileSystem, Path, Schema } from "effect";
import { EMBEDDING_MODEL_ID, EmbeddingModel } from "../semantic/EmbeddingModel.ts";
import { VaultRepository } from "./VaultRepository.ts";
import { inspectInitializedVaultStructure } from "./VaultStructure.ts";

export class VaultTemplateError extends Schema.TaggedErrorClass<VaultTemplateError>()(
  "VaultTemplateError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export const InitVaultResult = Schema.Struct({
  status: Schema.Literals(["initialized", "already_initialized"]),
  vaultPath: Schema.String,
  changes: Schema.Struct({
    createdDirectory: Schema.Boolean,
    copiedTemplate: Schema.Boolean,
    initializedGit: Schema.Boolean,
    updatedGitIgnore: Schema.Boolean,
  }),
  model: Schema.Struct({
    id: Schema.Literal(EMBEDDING_MODEL_ID),
    status: Schema.Literal("available"),
    installation: Schema.Literals(["downloaded", "already_available"]),
  }),
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "InitVaultResult" });
export type InitVaultResult = typeof InitVaultResult.Type;

export interface InitVaultOptions {
  readonly targetPath: string;
  readonly initializeGit: boolean;
  readonly yes: boolean;
}

const isCompatibleVault = Effect.fnUntraced(function* (
  vaultPath: string,
): Effect.fn.Return<boolean, VaultTemplateError, FileSystem.FileSystem | Path.Path> {
  const structure = yield* inspectInitializedVaultStructure(vaultPath).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to inspect existing vault structure: ${vaultPath}`,
          cause,
        }),
    ),
  );
  return structure.initialized;
});

const isDirectoryEmpty = Effect.fnUntraced(function* (
  directoryPath: string,
): Effect.fn.Return<boolean, VaultTemplateError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(directoryPath).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to inspect target directory: ${directoryPath}`,
          cause,
        }),
    ),
  );
  return entries.length === 0;
});

export const initVaultFromTemplate = Effect.fnUntraced(function* (
  options: InitVaultOptions,
): Effect.fn.Return<
  InitVaultResult,
  VaultTemplateError,
  EmbeddingModel | FileSystem.FileSystem | Path.Path | VaultRepository
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const embeddingModel = yield* EmbeddingModel;
  const vaultRepository = yield* VaultRepository;
  if (!path.isAbsolute(options.targetPath)) {
    return yield* new VaultTemplateError({
      message: `Vault target path must be absolute: ${options.targetPath}`,
    });
  }

  const targetExists = yield* fs.exists(options.targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to inspect target path: ${options.targetPath}`,
          cause,
        }),
    ),
  );

  if (targetExists && (yield* isCompatibleVault(options.targetPath))) {
    const model = yield* embeddingModel.install.pipe(
      Effect.mapError(
        (cause) =>
          new VaultTemplateError({
            message: cause.message,
            cause,
          }),
      ),
    );
    const repository = yield* vaultRepository
      .setup({
        vaultPath: options.targetPath,
        initializeGit: options.initializeGit,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VaultTemplateError({
              message: cause.message,
              cause,
            }),
        ),
      );
    return {
      status: "already_initialized",
      vaultPath: options.targetPath,
      changes: {
        createdDirectory: false,
        copiedTemplate: false,
        initializedGit: repository.initializedGit,
        updatedGitIgnore: repository.updatedGitIgnore,
      },
      model: { id: model.id, status: "available", installation: model.status },
      warnings: [],
    };
  }

  if (targetExists) {
    const empty = yield* isDirectoryEmpty(options.targetPath);
    if (!empty) {
      return yield* new VaultTemplateError({
        message:
          "Target exists and is not an initialized Agentic Memory vault or empty directory; refusing to overwrite.",
      });
    }
  }

  const model = yield* embeddingModel.install.pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: cause.message,
          cause,
        }),
    ),
  );

  if (!targetExists) {
    yield* fs.makeDirectory(options.targetPath, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new VaultTemplateError({
            message: `Failed to create vault target directory: ${options.targetPath}`,
            cause,
          }),
      ),
    );
  }

  const templatePath = yield* bundledVaultTemplatePath().pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: "Failed to resolve bundled Agentic Memory template path",
          cause,
        }),
    ),
  );
  yield* fs.copy(templatePath, options.targetPath, { overwrite: false }).pipe(
    Effect.mapError(
      (cause) =>
        new VaultTemplateError({
          message: `Failed to copy bundled Agentic Memory template into: ${options.targetPath}`,
          cause,
        }),
    ),
  );

  const repository = yield* vaultRepository
    .setup({
      vaultPath: options.targetPath,
      initializeGit: options.initializeGit,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new VaultTemplateError({
            message: cause.message,
            cause,
          }),
      ),
    );

  return {
    status: "initialized",
    vaultPath: options.targetPath,
    changes: {
      createdDirectory: !targetExists,
      copiedTemplate: true,
      initializedGit: repository.initializedGit,
      updatedGitIgnore: repository.updatedGitIgnore,
    },
    model: { id: model.id, status: "available", installation: model.status },
    warnings: [],
  };
});
