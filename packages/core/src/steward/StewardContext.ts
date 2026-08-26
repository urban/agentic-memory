import { Effect, FileSystem, Path, Schema } from "effect";
import { CapturePayload } from "../capture/CapturePayload.ts";
import { resolveVaultPaths, validateVaultForSteward } from "../vault/VaultStatus.ts";
import { buildStewardPrompt } from "./StewardPrompt.ts";

type ProjectSlug = import("../link/ProjectSlug.ts").ProjectSlug;

export const StewardContextVault = Schema.Struct({
  path: Schema.String,
  projectFile: Schema.String,
  memoryFile: Schema.String,
  userFile: Schema.String,
  outsideVaultInstructions: Schema.String,
}).annotate({ identifier: "StewardContextVault" });
export type StewardContextVault = typeof StewardContextVault.Type;

export const StewardContextInstructions = Schema.Struct({
  outsideVault: Schema.String,
  prompt: Schema.String,
}).annotate({ identifier: "StewardContextInstructions" });
export type StewardContextInstructions = typeof StewardContextInstructions.Type;

export const StewardContextResultContract = Schema.Struct({
  statusValues: Schema.Array(Schema.Literals(["captured", "no_changes"])),
  capturedRequiresSummary: Schema.Boolean,
}).annotate({ identifier: "StewardContextResultContract" });
export type StewardContextResultContract = typeof StewardContextResultContract.Type;

export const StewardContextResult = Schema.Struct({
  status: Schema.Literal("ready"),
  payload: CapturePayload,
  vault: StewardContextVault,
  instructions: StewardContextInstructions,
  resultContract: StewardContextResultContract,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "StewardContextResult" });
export type StewardContextResult = typeof StewardContextResult.Type;

export class StewardContextError extends Schema.TaggedError<StewardContextError>()(
  "StewardContextError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export const StewardContextResultJson = Schema.fromJsonString(StewardContextResult).annotate({
  identifier: "StewardContextResultJson",
});
export const encodeStewardContextResultJson = Schema.encodeUnknownEffect(StewardContextResultJson);
export const decodeStewardContextResultJson = Schema.decodeUnknownEffect(StewardContextResultJson);

export const buildStewardContext = Effect.fnUntraced(function* (input: {
  readonly payload: CapturePayload;
  readonly vaultPath: string;
  readonly projectSlug: ProjectSlug;
  readonly payloadWarnings: ReadonlyArray<string>;
}): Effect.fn.Return<StewardContextResult, StewardContextError, FileSystem.FileSystem | Path.Path> {
  if (input.payload.projectSlug !== input.projectSlug) {
    return yield* StewardContextError.make({
      message: `Payload projectSlug ${input.payload.projectSlug} does not match resolved project ${input.projectSlug}`,
    });
  }

  yield* validateVaultForSteward({
    vaultPath: input.vaultPath,
    projectSlug: input.projectSlug,
  }).pipe(
    Effect.mapError((cause) =>
      StewardContextError.make({
        message: cause.message,
        cause,
      }),
    ),
  );

  const paths = yield* resolveVaultPaths({
    vaultPath: input.vaultPath,
    projectSlug: input.projectSlug,
  });
  const fs = yield* FileSystem.FileSystem;
  const outsideVault = yield* fs.readFileString(paths.outsideVaultInstructions).pipe(
    Effect.mapError((cause) =>
      StewardContextError.make({
        message: `Failed to read outside-vault instructions: ${paths.outsideVaultInstructions}`,
        cause,
      }),
    ),
  );
  const prompt = yield* buildStewardPrompt({
    payload: input.payload,
    vault: paths,
    payloadWarnings: input.payloadWarnings,
  }).pipe(
    Effect.mapError((cause) =>
      StewardContextError.make({
        message: "Failed to encode steward prompt payload JSON",
        cause,
      }),
    ),
  );

  return StewardContextResult.make({
    status: "ready",
    payload: input.payload,
    vault: {
      path: paths.root,
      projectFile: paths.projectFile,
      memoryFile: paths.memoryFile,
      userFile: paths.userFile,
      outsideVaultInstructions: paths.outsideVaultInstructions,
    },
    instructions: {
      outsideVault,
      prompt,
    },
    resultContract: {
      statusValues: ["captured", "no_changes"],
      capturedRequiresSummary: true,
    },
    warnings: [...input.payloadWarnings],
  });
});
