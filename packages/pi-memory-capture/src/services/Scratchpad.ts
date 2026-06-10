import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import { decodeScratchpadJson, encodeScratchpadJson, type Scratchpad } from "../schema.ts";
import { boundScratchpad, emptyScratchpad } from "../scratchpad.ts";

export class ScratchpadServiceError extends Schema.TaggedErrorClass<ScratchpadServiceError>()(
  "ScratchpadServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface ScratchpadLoadResult {
  readonly scratchpad: Scratchpad;
  readonly warnings: ReadonlyArray<string>;
}

export class ScratchpadStore extends Context.Service<
  ScratchpadStore,
  {
    readonly load: (
      filepath: string,
      projectLink: string,
      updatedAt: string,
    ) => Effect.Effect<ScratchpadLoadResult>;
    readonly write: (
      filepath: string,
      scratchpad: Scratchpad,
      updatedAt: string,
    ) => Effect.Effect<Scratchpad, ScratchpadServiceError>;
  }
>()("@urban/pi-memory-capture/services/Scratchpad/ScratchpadStore") {
  static readonly layer = Layer.effect(
    ScratchpadStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const load = Effect.fn("ScratchpadStore.load")(function* (
        filepath: string,
        projectLink: string,
        updatedAt: string,
      ) {
        const exists = yield* fs.exists(filepath).pipe(Effect.catch(() => Effect.succeed(false)));
        if (!exists) {
          return {
            scratchpad: emptyScratchpad(projectLink, updatedAt),
            warnings: [],
          } satisfies ScratchpadLoadResult;
        }

        const readResult = yield* fs.readFileString(filepath).pipe(
          Effect.match({
            onFailure: (error) => ({
              _tag: "read_failed" as const,
              message: `Failed to read scratchpad file; using an empty one: ${error.message}`,
            }),
            onSuccess: (contents) => ({
              _tag: "contents" as const,
              contents,
            }),
          }),
        );
        if (readResult._tag === "read_failed") {
          return {
            scratchpad: emptyScratchpad(projectLink, updatedAt),
            warnings: [readResult.message],
          } satisfies ScratchpadLoadResult;
        }

        const contents = readResult.contents;
        if (contents.trim().length === 0) {
          return {
            scratchpad: emptyScratchpad(projectLink, updatedAt),
            warnings: ["Ignoring blank scratchpad and using an empty one."],
          } satisfies ScratchpadLoadResult;
        }

        const decoded = yield* decodeScratchpadJson(contents).pipe(
          Effect.match({
            onFailure: (error) => ({
              _tag: "invalid" as const,
              message: `Ignoring invalid scratchpad and using an empty one: ${error.message}`,
            }),
            onSuccess: (scratchpad) => ({
              _tag: "valid" as const,
              scratchpad,
            }),
          }),
        );

        if (decoded._tag === "invalid") {
          return {
            scratchpad: emptyScratchpad(projectLink, updatedAt),
            warnings: [decoded.message],
          } satisfies ScratchpadLoadResult;
        }

        if (decoded.scratchpad.projectLink !== projectLink) {
          return {
            scratchpad: emptyScratchpad(projectLink, updatedAt),
            warnings: [
              "Scratchpad project link did not match the current config; it was reset locally.",
            ],
          } satisfies ScratchpadLoadResult;
        }

        return {
          scratchpad: boundScratchpad(decoded.scratchpad, updatedAt),
          warnings: [],
        } satisfies ScratchpadLoadResult;
      });

      const write = Effect.fn("ScratchpadStore.write")(function* (
        filepath: string,
        scratchpad: Scratchpad,
        updatedAt: string,
      ): Effect.fn.Return<Scratchpad, ScratchpadServiceError> {
        const bounded = boundScratchpad(scratchpad, updatedAt);
        const encoded = yield* encodeScratchpadJson(bounded).pipe(
          Effect.mapError(
            (cause) =>
              new ScratchpadServiceError({
                message: "Failed to encode scratchpad JSON",
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(filepath, `${encoded}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new ScratchpadServiceError({
                message: `Failed to write scratchpad file: ${filepath}`,
                cause,
              }),
          ),
        );
        return bounded;
      });

      return ScratchpadStore.of({
        load,
        write,
      });
    }),
  );
}
