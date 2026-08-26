import { Context, Effect, Layer, Schema } from "effect";

export const EMBEDDING_MODEL_ID = "embeddinggemma-300M-Q8_0";
export const EMBEDDING_MODEL_URI =
  "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
export const EMBEDDING_MODEL_FILE_NAME = "embeddinggemma-300M-Q8_0.gguf";
export const EMBEDDING_MODEL_SHA256 =
  "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63";
export const EMBEDDING_MODEL_DIMENSIONS = 768;
export const MAX_EMBEDDING_BATCH_SIZE = 64;

export type EmbeddingModelInspection =
  | { readonly status: "missing"; readonly id: typeof EMBEDDING_MODEL_ID }
  | { readonly status: "available"; readonly id: typeof EMBEDDING_MODEL_ID };

export type EmbeddingModelInstallResult = {
  readonly status: "downloaded" | "already_available";
  readonly id: typeof EMBEDDING_MODEL_ID;
};

export class InvalidEmbeddingArtifactError extends Schema.TaggedError<InvalidEmbeddingArtifactError>()(
  "InvalidEmbeddingArtifactError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class EmbeddingModelDownloadError extends Schema.TaggedError<EmbeddingModelDownloadError>()(
  "EmbeddingModelDownloadError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class EmbeddingModelMissingError extends Schema.TaggedError<EmbeddingModelMissingError>()(
  "EmbeddingModelMissingError",
  { message: Schema.String },
) {}

export class EmbeddingBatchError extends Schema.TaggedError<EmbeddingBatchError>()(
  "EmbeddingBatchError",
  { message: Schema.String },
) {}

export class EmptyEmbeddingTextError extends Schema.TaggedError<EmptyEmbeddingTextError>()(
  "EmptyEmbeddingTextError",
  { message: Schema.String },
) {}

export class EmbeddingRuntimeError extends Schema.TaggedError<EmbeddingRuntimeError>()(
  "EmbeddingRuntimeError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type EmbeddingModelError =
  | InvalidEmbeddingArtifactError
  | EmbeddingModelDownloadError
  | EmbeddingModelMissingError
  | EmbeddingBatchError
  | EmptyEmbeddingTextError
  | EmbeddingRuntimeError;

export type EmbeddingModelAdapter = {
  readonly inspect: Effect.Effect<
    EmbeddingModelInspection,
    InvalidEmbeddingArtifactError | EmbeddingModelDownloadError
  >;
  readonly install: Effect.Effect<
    EmbeddingModelInstallResult,
    InvalidEmbeddingArtifactError | EmbeddingModelDownloadError
  >;
  readonly embed: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<
    ReadonlyArray<ReadonlyArray<number>>,
    | InvalidEmbeddingArtifactError
    | EmbeddingModelDownloadError
    | EmbeddingModelMissingError
    | EmbeddingRuntimeError
  >;
};

const validateEmbeddingVectors = (
  textCount: number,
  vectors: ReadonlyArray<ReadonlyArray<number>>,
): Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbeddingRuntimeError> => {
  if (vectors.length !== textCount) {
    return Effect.fail(
      EmbeddingRuntimeError.make({
        message: `Embedding runtime returned ${vectors.length} vectors for ${textCount} texts`,
      }),
    );
  }
  const wrongDimensionIndex = vectors.findIndex(
    (vector) => vector.length !== EMBEDDING_MODEL_DIMENSIONS,
  );
  if (wrongDimensionIndex >= 0) {
    return Effect.fail(
      EmbeddingRuntimeError.make({
        message: `Embedding vector ${wrongDimensionIndex} has dimension ${vectors[wrongDimensionIndex]?.length ?? 0}; expected ${EMBEDDING_MODEL_DIMENSIONS}`,
      }),
    );
  }
  const nonFiniteIndex = vectors.findIndex((vector) => !vector.every(Number.isFinite));
  return nonFiniteIndex >= 0
    ? Effect.fail(
        EmbeddingRuntimeError.make({
          message: `Embedding vector ${nonFiniteIndex} contains non-finite values`,
        }),
      )
    : Effect.succeed(vectors);
};

export class EmbeddingModel extends Context.Service<
  EmbeddingModel,
  {
    readonly inspect: Effect.Effect<
      EmbeddingModelInspection,
      InvalidEmbeddingArtifactError | EmbeddingModelDownloadError
    >;
    readonly install: Effect.Effect<
      EmbeddingModelInstallResult,
      InvalidEmbeddingArtifactError | EmbeddingModelDownloadError
    >;
    readonly embed: (
      texts: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbeddingModelError>;
  }
>()("@urban/agentic-memory-core/semantic/EmbeddingModel") {}

export const makeEmbeddingModel = (adapter: EmbeddingModelAdapter): EmbeddingModel["Service"] =>
  EmbeddingModel.of({
    inspect: adapter.inspect,
    install: adapter.install,
    embed: (texts) => {
      if (texts.length > MAX_EMBEDDING_BATCH_SIZE) {
        return Effect.fail(
          EmbeddingBatchError.make({
            message: `Embedding batches are limited to ${MAX_EMBEDDING_BATCH_SIZE} texts`,
          }),
        );
      }
      if (texts.some((text) => text.length === 0)) {
        return Effect.fail(
          EmptyEmbeddingTextError.make({
            message: "Embedding text must not be empty",
          }),
        );
      }
      return adapter
        .embed(texts)
        .pipe(Effect.flatMap((vectors) => validateEmbeddingVectors(texts.length, vectors)));
    },
  });

export type FakeEmbeddingModelOptions = {
  readonly initiallyAvailable?: boolean;
  readonly installError?: EmbeddingModelDownloadError;
};

export const makeFakeEmbeddingModel = (
  options: FakeEmbeddingModelOptions = {},
): EmbeddingModel["Service"] => {
  let available = options.initiallyAvailable ?? true;

  return makeEmbeddingModel({
    inspect: Effect.sync((): EmbeddingModelInspection =>
      available
        ? { status: "available", id: EMBEDDING_MODEL_ID }
        : { status: "missing", id: EMBEDDING_MODEL_ID },
    ),
    install:
      options.installError === undefined
        ? Effect.sync((): EmbeddingModelInstallResult => {
            const status = available ? "already_available" : "downloaded";
            available = true;
            return { status, id: EMBEDDING_MODEL_ID };
          })
        : Effect.fail(options.installError),
    embed: (texts) =>
      Effect.succeed(
        texts.map((text) =>
          Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
            index === 0 ? text.length : 0,
          ),
        ),
      ),
  });
};

export const makeFakeEmbeddingModelLayer = (
  options: FakeEmbeddingModelOptions = {},
): Layer.Layer<EmbeddingModel> => Layer.succeed(EmbeddingModel, makeFakeEmbeddingModel(options));
